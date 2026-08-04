#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-slate-do-production}"
REGION="${REGION:-europe-west1}"
HEALTH_URL="${HEALTH_URL:-https://slate.do/api/health}"
TRIGGER_NAME="${TRIGGER_NAME:-slate-main-deploy}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
DEFAULT_SERVICE_ACCOUNT="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
DEPLOY_SERVICE_ACCOUNT="slate-deploy@$PROJECT_ID.iam.gserviceaccount.com"
WEB_SERVICE_ACCOUNT="slate-web@$PROJECT_ID.iam.gserviceaccount.com"
MAINTENANCE_SERVICE_ACCOUNT="slate-maintenance@$PROJECT_ID.iam.gserviceaccount.com"
SCHEDULER_SERVICE_ACCOUNT="slate-scheduler@$PROJECT_ID.iam.gserviceaccount.com"

expect_equal() {
  label="$1"
  expected="$2"
  actual="$3"
  if [ "$actual" != "$expected" ]; then
    printf 'Expected %s to be %s, got %s\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
}

project_roles() {
  member="$1"
  gcloud projects get-iam-policy "$PROJECT_ID" \
    --flatten='bindings[].members' --filter="bindings.members=$member" \
    --format='value(bindings.role)' | sort
}

expect_resource_role() {
  label="$1"
  command_output="$2"
  role="$3"
  if ! grep -Fx "$role" <<<"$command_output" >/dev/null; then
    printf 'Missing %s role %s\n' "$label" "$role" >&2
    exit 1
  fi
}

deploy_member="serviceAccount:$DEPLOY_SERVICE_ACCOUNT"
web_member="serviceAccount:$WEB_SERVICE_ACCOUNT"
maintenance_member="serviceAccount:$MAINTENANCE_SERVICE_ACCOUNT"
scheduler_member="serviceAccount:$SCHEDULER_SERVICE_ACCOUNT"

expect_equal "deploy project roles" \
  $'roles/cloudbuild.builds.editor\nroles/cloudscheduler.admin\nroles/logging.logWriter\nroles/run.admin\nroles/serviceusage.serviceUsageConsumer' \
  "$(project_roles "$deploy_member")"
expect_equal "web project roles" "roles/cloudsql.client" "$(project_roles "$web_member")"
expect_equal "maintenance project roles" "roles/cloudsql.client" "$(project_roles "$maintenance_member")"
expect_equal "Scheduler project roles" "" "$(project_roles "$scheduler_member")"

for runtime_member in "$web_member" "$maintenance_member"; do
  cloud_sql_condition="$(gcloud projects get-iam-policy "$PROJECT_ID" \
    --flatten='bindings[].members' \
    --filter="bindings.members=$runtime_member AND bindings.role=roles/cloudsql.client" \
    --format='value(bindings.condition.expression)')"
  if ! grep -F "projects/$PROJECT_ID/instances/slate-postgres-ew1" <<<"$cloud_sql_condition" >/dev/null; then
    printf 'Cloud SQL access for %s is not restricted to slate-postgres-ew1\n' "$runtime_member" >&2
    exit 1
  fi
done

for secret in slate-database-url slate-session-secret slate-resend-api-key; do
  secret_roles="$(gcloud secrets get-iam-policy "$secret" --project "$PROJECT_ID" \
    --flatten='bindings[].members' --filter="bindings.members=$web_member" --format='value(bindings.role)')"
  expect_equal "$secret web access" roles/secretmanager.secretAccessor "$secret_roles"
done
maintenance_secret_roles="$(gcloud secrets get-iam-policy slate-database-url --project "$PROJECT_ID" \
  --flatten='bindings[].members' --filter="bindings.members=$maintenance_member" --format='value(bindings.role)')"
expect_equal "database maintenance access" roles/secretmanager.secretAccessor "$maintenance_secret_roles"
for secret in slate-session-secret slate-resend-api-key; do
  maintenance_secret_roles="$(gcloud secrets get-iam-policy "$secret" --project "$PROJECT_ID" \
    --flatten='bindings[].members' --filter="bindings.members=$maintenance_member" --format='value(bindings.role)')"
  expect_equal "$secret maintenance access" "" "$maintenance_secret_roles"
done
for secret in slate-database-url slate-session-secret slate-resend-api-key; do
  deploy_secret_roles="$(gcloud secrets get-iam-policy "$secret" --project "$PROJECT_ID" \
    --flatten='bindings[].members' --filter="bindings.members=$deploy_member" --format='value(bindings.role)')"
  expect_equal "$secret deploy access" "" "$deploy_secret_roles"
done
if gcloud secrets describe slate-invite-code --project "$PROJECT_ID" >/dev/null 2>&1; then
  invite_web_roles="$(gcloud secrets get-iam-policy slate-invite-code --project "$PROJECT_ID" \
    --flatten='bindings[].members' --filter="bindings.members=$web_member" --format='value(bindings.role)')"
  expect_equal "invite web access" roles/secretmanager.secretAccessor "$invite_web_roles"
  invite_maintenance_roles="$(gcloud secrets get-iam-policy slate-invite-code --project "$PROJECT_ID" \
    --flatten='bindings[].members' --filter="bindings.members=$maintenance_member" --format='value(bindings.role)')"
  expect_equal "invite maintenance access" "" "$invite_maintenance_roles"
  deploy_invite_roles="$(gcloud secrets get-iam-policy slate-invite-code --project "$PROJECT_ID" \
    --flatten='bindings[].members' --filter="bindings.members=$deploy_member" --format='value(bindings.role)')"
  expect_equal "invite metadata deploy access" roles/secretmanager.viewer "$deploy_invite_roles"
fi

artifact_roles="$(gcloud artifacts repositories get-iam-policy slate --project "$PROJECT_ID" --location "$REGION" \
  --flatten='bindings[].members' --filter="bindings.members=$deploy_member" --format='value(bindings.role)')"
expect_resource_role "Artifact Registry deploy access" "$artifact_roles" roles/artifactregistry.writer
bucket_roles="$(gcloud storage buckets get-iam-policy "gs://${PROJECT_ID}-slate-build" \
  --flatten='bindings[].members' --filter="bindings.members=$deploy_member" --format='value(bindings.role)')"
expect_resource_role "build bucket deploy access" "$bucket_roles" roles/storage.objectAdmin
expect_resource_role "build bucket metadata access" "$bucket_roles" roles/storage.bucketViewer

for service_account in "$WEB_SERVICE_ACCOUNT" "$MAINTENANCE_SERVICE_ACCOUNT" "$SCHEDULER_SERVICE_ACCOUNT"; do
  identity_roles="$(gcloud iam service-accounts get-iam-policy "$service_account" --project "$PROJECT_ID" \
    --flatten='bindings[].members' --filter="bindings.members=$deploy_member" --format='value(bindings.role)')"
  expect_resource_role "$service_account deploy attachment" "$identity_roles" roles/iam.serviceAccountUser
done
deploy_self_roles="$(gcloud iam service-accounts get-iam-policy "$DEPLOY_SERVICE_ACCOUNT" --project "$PROJECT_ID" \
  --flatten='bindings[].members' --filter="bindings.members=$deploy_member" --format='value(bindings.role)')"
expect_equal "deploy self attachment" roles/iam.serviceAccountUser "$deploy_self_roles"

expect_equal "Cloud Build trigger identity" \
  "projects/$PROJECT_ID/serviceAccounts/$DEPLOY_SERVICE_ACCOUNT" \
  "$(gcloud builds triggers describe "$TRIGGER_NAME" --project "$PROJECT_ID" --region global --format='value(serviceAccount)')"
expect_equal "web runtime identity" "$WEB_SERVICE_ACCOUNT" \
  "$(gcloud run services describe slate --project "$PROJECT_ID" --region "$REGION" --format='value(spec.template.spec.serviceAccountName)')"
expect_equal "cleanup runtime identity" "$MAINTENANCE_SERVICE_ACCOUNT" \
  "$(gcloud run jobs describe slate-cleanup --project "$PROJECT_ID" --region "$REGION" --format='value(spec.template.spec.template.spec.serviceAccountName)')"
expect_equal "Scheduler caller identity" "$SCHEDULER_SERVICE_ACCOUNT" \
  "$(gcloud scheduler jobs describe slate-cleanup --project "$PROJECT_ID" --location "$REGION" --format='value(httpTarget.oauthToken.serviceAccountEmail)')"
scheduler_job_roles="$(gcloud run jobs get-iam-policy slate-cleanup --project "$PROJECT_ID" --region "$REGION" \
  --flatten='bindings[].members' --filter="bindings.members=$scheduler_member" --format='value(bindings.role)')"
expect_resource_role "Scheduler cleanup invocation" "$scheduler_job_roles" roles/run.invoker

response="$(curl --fail --silent --show-error --retry 6 --retry-all-errors --retry-delay 5 --max-time 10 "$HEALTH_URL")"
printf '%s\n' "$response"
grep -F '"database":"ok"' <<<"$response" >/dev/null

gcloud run jobs execute slate-cleanup --project "$PROJECT_ID" --region "$REGION" --wait --quiet
previous_execution="$(gcloud run jobs executions list --job slate-cleanup --project "$PROJECT_ID" --region "$REGION" --sort-by='~createTime' --limit 1 --format='value(name)')"
gcloud scheduler jobs run slate-cleanup --project "$PROJECT_ID" --location "$REGION" --quiet

scheduler_execution=""
for _ in $(seq 1 60); do
  scheduler_execution="$(gcloud run jobs executions list --job slate-cleanup --project "$PROJECT_ID" --region "$REGION" --sort-by='~createTime' --limit 1 --format='value(name)')"
  if [ -n "$scheduler_execution" ] && [ "$scheduler_execution" != "$previous_execution" ]; then
    break
  fi
  sleep 5
done
if [ -z "$scheduler_execution" ] || [ "$scheduler_execution" = "$previous_execution" ]; then
  printf 'Scheduler did not create a new slate-cleanup execution\n' >&2
  exit 1
fi

for _ in $(seq 1 60); do
  completion="$(gcloud run jobs executions describe "$scheduler_execution" --project "$PROJECT_ID" --region "$REGION" --format='value(status.completionTime)')"
  if [ -n "$completion" ]; then
    break
  fi
  sleep 5
done
succeeded="$(gcloud run jobs executions describe "$scheduler_execution" --project "$PROJECT_ID" --region "$REGION" --format='value(status.succeededCount)')"
expect_equal "Scheduler cleanup succeeded task count" "1" "$succeeded"

PROJECT_ID="$PROJECT_ID" bash scripts/gcp-remove-default-roles.sh
printf 'Verified Slate identities and finalized the default compute cutover.\n'
