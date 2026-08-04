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
  assert_contains "$file" "gcloud secrets versions access latest --secret=slate-invite-code"
  assert_contains "$file" "gcloud run services list"
  assert_contains "$file" "existing_env_names"
  assert_contains "$file" "The live service uses INVITE_CODE, but slate-invite-code:latest is not accessible"
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
assert_contains justfile 'test-ci:'
assert_contains justfile 'scripts/test-server-ci.sh'
assert_contains justfile 'npm run test:browser'
assert_contains scripts/test-server-ci.sh 'go test -count=1 -json ./server/...'
assert_contains scripts/verify-github-ci.sh 'github-actions'
assert_contains scripts/verify-github-ci.sh '15368'
assert_contains cloudbuild.yaml "_MAX_INSTANCES: '4'"
assert_contains cloudbuild.yaml "_DB_MAX_CONNECTIONS: '2'"
assert_contains cloudbuild.yaml "_DB_CONNECTION_ALLOWANCE: '25'"
assert_contains cloudbuild.yaml "_DB_RESERVED_CONNECTIONS: '9'"
assert_contains cloudbuild.yaml "_REQUEST_TIMEOUT_SECONDS: '15'"
assert_contains cloudbuild.yaml '_REQUEST_TIMEOUT_SECONDS + 5'
assert_not_contains cloudbuild.yaml '_CLOUD_RUN_REQUEST_TIMEOUT'
assert_not_contains cloudbuild.yaml '-lc'
assert_contains docs/deploy.md 'roles/cloudbuild.builds.viewer'
assert_contains docs/deploy.md '4 × 2 = 8'
assert_contains docs/deploy.md 'scripts/check-capacity.sh'
assert_contains docs/deploy.md 'database/postgresql/num_backends'
assert_contains docs/deploy.md 'data-retention.md'
assert_contains scripts/gcp-bootstrap.sh 'cloudscheduler.googleapis.com'
assert_contains scripts/gcp-bootstrap.sh 'roles/run.invoker'
assert_contains scripts/gcp-bootstrap.sh 'roles/cloudscheduler.admin'
assert_contains scripts/gcp-bootstrap.sh 'roles/iam.serviceAccountUser'
assert_contains cloudbuild.yaml 'https://run.googleapis.com/v2/projects/'

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
