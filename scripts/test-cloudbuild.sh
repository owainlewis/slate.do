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
  assert_not_contains "$file" "--add-cloudsql-instances"
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
assert_not_contains cloudbuild.yaml '-lc'
assert_contains docs/deploy.md 'roles/cloudbuild.builds.viewer'

lock_attempts="$(grep -c -- '--if-generation-match=0' cloudbuild.yaml)"
if [ "$lock_attempts" -ne 2 ]; then
  printf 'cloudbuild.yaml must attempt lock creation twice, found %s attempts\n' "$lock_attempts" >&2
  exit 1
fi
