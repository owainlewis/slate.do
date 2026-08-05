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

SLATE_ROLES=(
  roles/artifactregistry.writer
  roles/cloudbuild.builds.viewer
  roles/cloudscheduler.admin
  roles/cloudsql.client
  roles/iam.serviceAccountUser
  roles/logging.logWriter
  roles/run.admin
  roles/run.invoker
  roles/secretmanager.secretAccessor
  roles/storage.objectAdmin
)

current_roles="$(project_roles)"
for role in "${SLATE_ROLES[@]}"; do
  if grep -Fx "$role" <<<"$current_roles" >/dev/null; then
    gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
      --member "$default_member" --role "$role" --condition=None >/dev/null
  fi
done

remaining_roles="$(project_roles)"
remaining_slate_roles=""
for role in "${SLATE_ROLES[@]}"; do
  if grep -Fx "$role" <<<"$remaining_roles" >/dev/null; then
    remaining_slate_roles="${remaining_slate_roles}${remaining_slate_roles:+$'\n'}${role}"
  fi
done
if [ -n "$remaining_slate_roles" ]; then
  printf 'Default compute service account still has Slate project roles:\n%s\n' "$remaining_slate_roles" >&2
  exit 1
fi

if [ -n "$remaining_roles" ]; then
  printf 'Preserved unrelated project roles on the default compute service account:\n%s\n' "$remaining_roles"
fi

printf 'Removed Slate project roles from %s.\n' "$DEFAULT_SERVICE_ACCOUNT"
