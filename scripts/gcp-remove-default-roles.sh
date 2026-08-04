#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-slate-do-production}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
DEFAULT_SERVICE_ACCOUNT="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
default_member="serviceAccount:$DEFAULT_SERVICE_ACCOUNT"

project_roles() {
  gcloud projects get-iam-policy "$PROJECT_ID" \
    --flatten='bindings[].members' --filter="bindings.members=$default_member" \
    --format='value(bindings.role)' | sort
}

current_roles="$(project_roles)"
for role in \
  roles/artifactregistry.writer \
  roles/cloudbuild.builds.viewer \
  roles/cloudscheduler.admin \
  roles/cloudsql.client \
  roles/iam.serviceAccountUser \
  roles/logging.logWriter \
  roles/run.admin \
  roles/run.invoker \
  roles/secretmanager.secretAccessor \
  roles/storage.objectAdmin
do
  if grep -Fx "$role" <<<"$current_roles" >/dev/null; then
    gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
      --member "$default_member" --role "$role" --condition=None >/dev/null
  fi
done

remaining_roles="$(project_roles)"
if [ -n "$remaining_roles" ]; then
  printf 'Default compute service account still has project roles:\n%s\n' "$remaining_roles" >&2
  exit 1
fi

printf 'Removed Slate project roles from %s.\n' "$DEFAULT_SERVICE_ACCOUNT"
