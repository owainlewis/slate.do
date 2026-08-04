#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-slate-do-production}"
REGION="${REGION:-europe-west1}"
INSTANCE="${INSTANCE:-slate-postgres-ew1}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-slate}"
BUILD_BUCKET="${BUILD_BUCKET:-gs://${PROJECT_ID}-slate-build}"
TRIGGER_NAME="${TRIGGER_NAME:-slate-main-deploy}"
OPERATOR_PRINCIPAL="${OPERATOR_PRINCIPAL:-user:$(gcloud config get-value account 2>/dev/null)}"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
DEPLOY_SERVICE_ACCOUNT="slate-deploy@$PROJECT_ID.iam.gserviceaccount.com"
WEB_SERVICE_ACCOUNT="slate-web@$PROJECT_ID.iam.gserviceaccount.com"
MAINTENANCE_SERVICE_ACCOUNT="slate-maintenance@$PROJECT_ID.iam.gserviceaccount.com"
SCHEDULER_SERVICE_ACCOUNT="slate-scheduler@$PROJECT_ID.iam.gserviceaccount.com"
BUILD_SERVICE_AGENT="service-$PROJECT_NUMBER@gcp-sa-cloudbuild.iam.gserviceaccount.com"

ensure_service_account() {
  account_id="$1"
  display_name="$2"
  email="$account_id@$PROJECT_ID.iam.gserviceaccount.com"
  if ! gcloud iam service-accounts describe "$email" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$account_id" --project "$PROJECT_ID" --display-name "$display_name"
  fi
}

grant_project_role() {
  member="$1"
  role="$2"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "$member" --role "$role" --condition=None >/dev/null
}

grant_service_account_role() {
  service_account="$1"
  member="$2"
  role="$3"
  gcloud iam service-accounts add-iam-policy-binding "$service_account" \
    --project "$PROJECT_ID" --member "$member" --role "$role" >/dev/null
}

grant_secret_role_if_present() {
  secret="$1"
  member="$2"
  role="$3"
  if gcloud secrets describe "$secret" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT_ID" \
      --member "$member" --role "$role" >/dev/null
  fi
}

grant_required_secret_role() {
  secret="$1"
  member="$2"
  role="$3"
  if ! gcloud secrets describe "$secret" --project "$PROJECT_ID" >/dev/null 2>&1; then
    printf 'Required secret %s does not exist in %s\n' "$secret" "$PROJECT_ID" >&2
    exit 1
  fi
  gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT_ID" \
    --member "$member" --role "$role" >/dev/null
}

ensure_service_account slate-deploy "Slate build and deploy"
ensure_service_account slate-web "Slate public web runtime"
ensure_service_account slate-maintenance "Slate migration and cleanup jobs"
ensure_service_account slate-scheduler "Slate cleanup Scheduler caller"

if ! gcloud storage buckets describe "$BUILD_BUCKET" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud storage buckets create "$BUILD_BUCKET" --project "$PROJECT_ID" \
    --location "$REGION" --uniform-bucket-level-access
fi

deploy_member="serviceAccount:$DEPLOY_SERVICE_ACCOUNT"
web_member="serviceAccount:$WEB_SERVICE_ACCOUNT"
maintenance_member="serviceAccount:$MAINTENANCE_SERVICE_ACCOUNT"
scheduler_member="serviceAccount:$SCHEDULER_SERVICE_ACCOUNT"

for role in \
  roles/cloudbuild.builds.viewer \
  roles/cloudscheduler.admin \
  roles/logging.logWriter \
  roles/run.admin
do
  grant_project_role "$deploy_member" "$role"
done

gcloud artifacts repositories add-iam-policy-binding "$ARTIFACT_REPOSITORY" \
  --project "$PROJECT_ID" --location "$REGION" \
  --member "$deploy_member" --role roles/artifactregistry.writer >/dev/null
gcloud storage buckets add-iam-policy-binding "$BUILD_BUCKET" \
  --member "$deploy_member" --role roles/storage.objectAdmin >/dev/null

for runtime_member in "$web_member" "$maintenance_member"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "$runtime_member" --role roles/cloudsql.client \
    --condition="expression=resource.name == 'projects/$PROJECT_ID/instances/$INSTANCE',title=slate-cloud-sql-instance,description=Only the Slate production PostgreSQL instance" >/dev/null
done

for secret in slate-database-url slate-session-secret slate-resend-api-key; do
  grant_required_secret_role "$secret" "$web_member" roles/secretmanager.secretAccessor
done
grant_secret_role_if_present slate-invite-code "$web_member" roles/secretmanager.secretAccessor
grant_required_secret_role slate-database-url "$maintenance_member" roles/secretmanager.secretAccessor
grant_secret_role_if_present slate-invite-code "$deploy_member" roles/secretmanager.viewer

for service_account in "$WEB_SERVICE_ACCOUNT" "$MAINTENANCE_SERVICE_ACCOUNT" "$SCHEDULER_SERVICE_ACCOUNT"; do
  grant_service_account_role "$service_account" "$deploy_member" roles/iam.serviceAccountUser
done
grant_service_account_role "$DEPLOY_SERVICE_ACCOUNT" "serviceAccount:$BUILD_SERVICE_AGENT" roles/iam.serviceAccountTokenCreator

if [ -n "$OPERATOR_PRINCIPAL" ] && [ "$OPERATOR_PRINCIPAL" != "user:" ]; then
  grant_service_account_role "$DEPLOY_SERVICE_ACCOUNT" "$OPERATOR_PRINCIPAL" roles/iam.serviceAccountUser
fi

if gcloud builds triggers describe "$TRIGGER_NAME" --project "$PROJECT_ID" --region global >/dev/null 2>&1; then
  gcloud builds triggers update github "$TRIGGER_NAME" \
    --project "$PROJECT_ID" --region global \
    --service-account "projects/$PROJECT_ID/serviceAccounts/$DEPLOY_SERVICE_ACCOUNT" >/dev/null
fi

printf 'Slate identities are ready:\n  deploy: %s\n  web: %s\n  maintenance: %s\n  scheduler: %s\n' \
  "$DEPLOY_SERVICE_ACCOUNT" "$WEB_SERVICE_ACCOUNT" "$MAINTENANCE_SERVICE_ACCOUNT" "$SCHEDULER_SERVICE_ACCOUNT"
