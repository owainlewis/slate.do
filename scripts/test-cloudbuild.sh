#!/bin/sh
set -eu

assert_contains() {
  file="$1"
  text="$2"
  if ! grep -F -- "$text" "$file" >/dev/null; then
    printf '%s is missing required deployment setting: %s\n' "$file" "$text" >&2
    exit 1
  fi
}

assert_not_contains() {
  file="$1"
  text="$2"
  if grep -F -- "$text" "$file" >/dev/null; then
    printf '%s contains unsafe deployment setting: %s\n' "$file" "$text" >&2
    exit 1
  fi
}

for file in cloudbuild.yaml scripts/gcp-deploy.sh; do
  assert_contains "$file" "slate-migrate"
  assert_contains "$file" "slate-cleanup"
  assert_contains "$file" "--args cleanup"
  assert_contains "$file" '17 3 * * *'
  assert_contains "$file" "--attempt-deadline 300s"
  assert_contains "$file" "--max-retries 1"
  assert_contains "$file" "slate-postgres-ew1"
  assert_contains "$file" "INVITE_CODE=slate-invite-code:latest"
  assert_contains "$file" "secrets versions describe latest --secret=slate-invite-code --format='value(state)'"
  assert_contains "$file" 'invite_secret_state'
  assert_contains "$file" '= ENABLED ]'
  assert_contains "$file" "run services list"
  assert_contains "$file" "existing_env_names"
  assert_contains "$file" "The live service uses INVITE_CODE, but slate-invite-code:latest is not enabled or accessible"
  assert_not_contains "$file" "env[].name)' 2>/dev/null"
  assert_contains "$file" '"database":"ok"'
  assert_contains "$file" "--ingress"
  assert_contains "$file" "all"
  assert_contains "$file" "DB_MAX_CONNECTIONS"
  assert_contains "$file" "DB_ACQUIRE_TIMEOUT"
  assert_contains "$file" "DB_STATEMENT_TIMEOUT"
  assert_contains "$file" "DB_IDLE_TRANSACTION_TIMEOUT"
  assert_contains "$file" "REQUEST_TIMEOUT"
  assert_contains "$file" "scripts/check-capacity.sh"
  assert_contains "$file" "scripts/validate-capacity.sh"
  assert_contains "$file" "Effective capacity:"
  assert_contains "$file" "databaseMaxConnections"
  assert_contains "$file" "applicationConnectionLimit"
  assert_contains "$file" "--max"
  assert_contains "$file" "--concurrency"
  assert_contains "$file" "--timeout"
  assert_not_contains "$file" "--add-cloudsql-instances"
  assert_not_contains "$file" "--max-instances"
  assert_not_contains "$file" "europe-west2"
  assert_not_contains "$file" "slate-postgres,"
done

assert_contains cloudbuild.yaml 'slate-migrate-$SHORT_SHA'
assert_contains cloudbuild.yaml 'serviceAccount: projects/$PROJECT_ID/serviceAccounts/slate-deploy@$PROJECT_ID.iam.gserviceaccount.com'
assert_contains cloudbuild.yaml 'slate-web@$PROJECT_ID.iam.gserviceaccount.com'
assert_contains cloudbuild.yaml 'slate-maintenance@$PROJECT_ID.iam.gserviceaccount.com'
assert_contains cloudbuild.yaml 'slate-scheduler@$PROJECT_ID.iam.gserviceaccount.com'
assert_contains cloudbuild.yaml '--service-account "$$web_service_account"'
assert_contains cloudbuild.yaml '--service-account "$$maintenance_service_account"'
assert_contains cloudbuild.yaml '--member="serviceAccount:$$scheduler_service_account" --role=roles/run.invoker'
assert_contains cloudbuild.yaml 'gs://${PROJECT_ID}-slate-build/deploy/slate.lock'
assert_not_contains cloudbuild.yaml 'compute@developer.gserviceaccount.com'
assert_contains cloudbuild.yaml '_REGION: europe-west1'
assert_contains cloudbuild.yaml 'slate.lock'
assert_contains cloudbuild.yaml '--if-generation-match=0'
assert_contains cloudbuild.yaml 'Unable to create or inspect the production deployment lock'
assert_contains cloudbuild.yaml 'Waiting for production deployment lock'
assert_contains cloudbuild.yaml 'Could not verify production deployment lock owner'
assert_contains cloudbuild.yaml 'SUCCESS|FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED'
assert_contains cloudbuild.yaml 'git ls-remote https://github.com/owainlewis/slate.do.git refs/heads/main'
assert_contains cloudbuild.yaml 'Expected deployed image'
assert_contains cloudbuild.yaml '$COMMIT_SHA-$BUILD_ID'
assert_contains cloudbuild.yaml 'image_summary.fully_qualified_digest'
assert_contains cloudbuild.yaml 'go test ./...'
assert_contains cloudbuild.yaml 'scripts/verify-github-ci.sh'
assert_contains .github/workflows/ci.yml 'name: Required CI'
assert_contains .github/workflows/ci.yml 'postgres:18-alpine'
assert_contains .github/workflows/ci.yml 'SLATE_TEST_DATABASE_URL'
assert_contains .github/workflows/ci.yml 'npx playwright install --with-deps chromium'
assert_contains .github/workflows/ci.yml 'extractions/setup-just@v3'
assert_contains .github/workflows/ci.yml 'just-version: "1.50.0"'
assert_contains .github/workflows/ci.yml 'just test-ci'
assert_contains .github/workflows/ci.yml 'timeout-minutes: 10'
assert_contains justfile 'test-ci:'
assert_contains justfile 'scripts/test-server-ci.sh'
assert_contains justfile 'npm run test:browser'
assert_contains package.json '--test-timeout=60000'
assert_contains scripts/test-server-ci.sh 'go test -count=1 -timeout=5m -json ./server/...'
assert_contains scripts/test-server-ci.sh 'tee "$test_log"'
assert_contains scripts/verify-github-ci.sh 'github-actions'
assert_contains scripts/verify-github-ci.sh '15368'
assert_contains scripts/verify-github-ci.sh 'GitHub API unavailable'
assert_contains scripts/verify-github-ci.sh '--connect-timeout 10 --max-time "$request_timeout"'
assert_contains scripts/verify-github-ci.sh 'VERIFY_GITHUB_CI_MAX_ATTEMPTS:-45'
assert_contains scripts/verify-github-ci.sh 'VERIFY_GITHUB_CI_POLL_SECONDS:-20'
assert_contains scripts/verify-github-ci.sh 'VERIFY_GITHUB_CI_TIMEOUT_SECONDS:-900'
assert_contains cloudbuild.yaml "_MAX_INSTANCES: '4'"
assert_contains cloudbuild.yaml "_DB_MAX_CONNECTIONS: '2'"
assert_contains cloudbuild.yaml "_DB_CONNECTION_ALLOWANCE: '25'"
assert_contains cloudbuild.yaml "_DB_RESERVED_CONNECTIONS: '9'"
assert_contains cloudbuild.yaml "_REQUEST_TIMEOUT_SECONDS: '15'"
assert_contains cloudbuild.yaml '_REQUEST_TIMEOUT_SECONDS + 5'
assert_not_contains cloudbuild.yaml '_CLOUD_RUN_REQUEST_TIMEOUT'
assert_not_contains cloudbuild.yaml '-lc'
assert_contains docs/deploy.md 'roles/cloudbuild.builds.editor'
assert_contains docs/deploy.md 'gcloud secrets create slate-invite-code --project="$PROJECT_ID"'
assert_contains docs/deploy.md 'gcloud secrets versions add slate-invite-code --project="$PROJECT_ID"'
assert_contains docs/deploy.md 'PROJECT_ID="$PROJECT_ID" bash scripts/gcp-identities.sh'
assert_contains docs/deploy.md 'gcloud run services update slate --project="$PROJECT_ID"'
assert_contains docs/deploy.md 'The identity script must run after the secret exists and before invite registration is enabled.'
assert_contains docs/deploy.md '4 × 2 = 8'
assert_contains docs/deploy.md 'scripts/check-capacity.sh'
assert_contains docs/deploy.md 'database/postgresql/num_backends'
assert_contains docs/deploy.md 'data-retention.md'
assert_contains scripts/gcp-bootstrap.sh 'cloudscheduler.googleapis.com'
assert_contains scripts/gcp-bootstrap.sh 'scripts/gcp-identities.sh'
assert_contains cloudbuild.yaml 'https://run.googleapis.com/v2/projects/'

assert_contains scripts/gcp-deploy.sh '--service-account "projects/$PROJECT_ID/serviceAccounts/$DEPLOY_SERVICE_ACCOUNT"'
assert_contains scripts/gcp-deploy.sh 'gcloud --project "$PROJECT_ID" --impersonate-service-account="$DEPLOY_SERVICE_ACCOUNT" "$@"'
assert_not_contains scripts/gcp-deploy.sh 'gcloud config set project'
assert_contains scripts/gcp-deploy.sh '--service-account "$WEB_SERVICE_ACCOUNT"'
assert_contains scripts/gcp-deploy.sh '--service-account "$MAINTENANCE_SERVICE_ACCOUNT"'
assert_contains scripts/gcp-deploy.sh '--oauth-service-account-email "$SCHEDULER_SERVICE_ACCOUNT"'
assert_not_contains scripts/gcp-deploy.sh 'compute@developer.gserviceaccount.com'

assert_contains scripts/gcp-identities.sh 'roles/cloudbuild.builds.editor'
assert_contains scripts/gcp-identities.sh 'remove_project_role_if_present "$deploy_member" roles/cloudbuild.builds.viewer'
assert_contains scripts/gcp-identities.sh 'roles/cloudscheduler.admin'
assert_contains scripts/gcp-identities.sh 'roles/run.admin'
assert_contains scripts/gcp-identities.sh 'roles/serviceusage.serviceUsageConsumer'
assert_contains scripts/gcp-finalize-identities.sh 'roles/serviceusage.serviceUsageConsumer'
assert_contains scripts/gcp-identities.sh 'roles/artifactregistry.writer'
assert_contains scripts/gcp-identities.sh 'roles/storage.objectAdmin'
assert_contains scripts/gcp-identities.sh 'roles/storage.bucketViewer'
assert_contains scripts/gcp-finalize-identities.sh 'roles/storage.bucketViewer'
assert_contains scripts/gcp-identities.sh "resource.name == 'projects/\$PROJECT_ID/instances/\$INSTANCE'"
assert_contains scripts/gcp-identities.sh 'gcloud secrets add-iam-policy-binding'
assert_contains scripts/gcp-identities.sh 'roles/secretmanager.secretAccessor'
assert_contains scripts/gcp-identities.sh 'roles/iam.serviceAccountUser'
assert_contains scripts/gcp-identities.sh 'grant_service_account_role "$DEPLOY_SERVICE_ACCOUNT" "$deploy_member" roles/iam.serviceAccountUser'
assert_contains scripts/gcp-identities.sh 'roles/iam.serviceAccountTokenCreator'
assert_contains scripts/gcp-identities.sh 'grant_service_account_role "$DEPLOY_SERVICE_ACCOUNT" "$OPERATOR_PRINCIPAL" roles/iam.serviceAccountTokenCreator'
assert_contains scripts/gcp-finalize-identities.sh 'expect_equal "deploy self attachment" roles/iam.serviceAccountUser'
assert_not_contains scripts/gcp-identities.sh 'compute@developer.gserviceaccount.com'

assert_contains scripts/gcp-finalize-identities.sh 'gcloud run jobs execute slate-cleanup'
assert_contains scripts/gcp-finalize-identities.sh 'gcloud scheduler jobs run slate-cleanup'
assert_contains scripts/gcp-finalize-identities.sh 'roles/secretmanager.secretAccessor'
assert_contains scripts/gcp-finalize-identities.sh 'compute@developer.gserviceaccount.com'
assert_contains scripts/gcp-finalize-identities.sh 'scripts/gcp-remove-default-roles.sh'

default_role_state="$(mktemp)"
retry_state="$(mktemp)"
retry_output="$(mktemp)"
trap 'rm -f "$retry_state" "$retry_output" "$default_role_state"' EXIT INT TERM
awk '/^for role in /,/^do$/ { if ($1 ~ /^roles\//) { gsub(/\\/, "", $1); print $1 } }' \
  scripts/gcp-remove-default-roles.sh >"$default_role_state"
if [ "$(wc -l <"$default_role_state" | tr -d ' ')" -ne 10 ]; then
  printf '%s\n' 'default-role removal test did not discover all ten legacy roles' >&2
  exit 1
fi
for _ in 1 2; do
  GCP_DEFAULT_ROLE_STATE="$default_role_state" \
    PATH="$PWD/scripts/testdata/gcp-identities:$PATH" \
    PROJECT_ID=slate-test bash scripts/gcp-remove-default-roles.sh >/dev/null
done
if [ -s "$default_role_state" ]; then
  printf '%s\n' 'default-role removal was not complete and idempotent' >&2
  exit 1
fi

bash -n scripts/gcp-bootstrap.sh scripts/gcp-deploy.sh scripts/gcp-identities.sh scripts/gcp-finalize-identities.sh

if ! VERIFY_GITHUB_CI_CURL_STATE="$retry_state" \
  PATH="$PWD/scripts/testdata/verify-github-ci:$PATH" \
  sh scripts/verify-github-ci.sh deadbeef >"$retry_output" 2>&1; then
  printf '%s\n' 'Required CI polling did not recover from a transient GitHub API failure' >&2
  exit 1
fi
assert_contains "$retry_output" 'GitHub API unavailable'
assert_contains "$retry_output" 'Required CI passed for deadbeef'
if [ "$(sed -n '1p' "$retry_state")" -ne 2 ]; then
  printf '%s\n' 'Required CI polling did not retry exactly once before succeeding' >&2
  exit 1
fi

: >"$retry_state"
if VERIFY_GITHUB_CI_CURL_MODE=timed-out \
  VERIFY_GITHUB_CI_CURL_STATE="$retry_state" \
  PATH="$PWD/scripts/testdata/verify-github-ci:$PATH" \
  sh scripts/verify-github-ci.sh deadbeef >"$retry_output" 2>&1; then
  printf '%s\n' 'Required CI polling accepted a timed-out workflow' >&2
  exit 1
fi
assert_contains "$retry_output" 'Required CI failed for deadbeef (timed_out)'

: >"$retry_state"
if VERIFY_GITHUB_CI_CURL_MODE=pending \
  VERIFY_GITHUB_CI_CURL_STATE="$retry_state" \
  VERIFY_GITHUB_CI_MAX_ATTEMPTS=2 \
  VERIFY_GITHUB_CI_POLL_SECONDS=0 \
  PATH="$PWD/scripts/testdata/verify-github-ci:$PATH" \
  sh scripts/verify-github-ci.sh deadbeef >"$retry_output" 2>&1; then
  printf '%s\n' 'Required CI polling accepted a workflow that never completed' >&2
  exit 1
fi
assert_contains "$retry_output" 'Timed out waiting for Required CI on deadbeef'
if [ "$(sed -n '1p' "$retry_state")" -ne 2 ]; then
  printf '%s\n' 'Required CI polling did not honor its configured attempt limit' >&2
  exit 1
fi

: >"$retry_state"
deadline_started="$(date +%s)"
if VERIFY_GITHUB_CI_CURL_MODE=slow-pending \
  VERIFY_GITHUB_CI_CURL_STATE="$retry_state" \
  VERIFY_GITHUB_CI_MAX_ATTEMPTS=2 \
  VERIFY_GITHUB_CI_POLL_SECONDS=0 \
  VERIFY_GITHUB_CI_TIMEOUT_SECONDS=2 \
  PATH="$PWD/scripts/testdata/verify-github-ci:$PATH" \
  sh scripts/verify-github-ci.sh deadbeef >"$retry_output" 2>&1; then
  printf '%s\n' 'Required CI polling accepted a slow workflow that never completed' >&2
  exit 1
fi
deadline_elapsed="$(( $(date +%s) - deadline_started ))"
assert_contains "$retry_output" 'Timed out waiting for Required CI on deadbeef'
if [ "$(sed -n '1p' "$retry_state")" -ne 1 ] || [ "$deadline_elapsed" -gt 3 ]; then
  printf 'Required CI wall-clock deadline was not enforced: attempts=%s elapsed=%ss\n' \
    "$(sed -n '1p' "$retry_state")" "$deadline_elapsed" >&2
  exit 1
fi

lock_attempts="$(grep -c -- '--if-generation-match=0' cloudbuild.yaml)"
if [ "$lock_attempts" -ne 2 ]; then
  printf 'cloudbuild.yaml must attempt lock creation twice, found %s attempts\n' "$lock_attempts" >&2
  exit 1
fi

sh scripts/validate-capacity.sh 4 2 25 9 15 >/dev/null
if sh scripts/validate-capacity.sh 9 2 25 9 15 >/dev/null 2>&1; then
  printf '%s\n' 'capacity preflight accepted an unsafe instance and pool product' >&2
  exit 1
fi
if sh scripts/validate-capacity.sh 4 2 25 9 0 >/dev/null 2>&1; then
  printf '%s\n' 'capacity preflight accepted an invalid request timeout' >&2
  exit 1
fi
