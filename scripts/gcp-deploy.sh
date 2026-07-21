#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-slate-do-production}"
REGION="${REGION:-europe-west1}"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/slate/slate:manual-$(git rev-parse --short HEAD)"
CLOUD_SQL_INSTANCES="$PROJECT_ID:$REGION:slate-postgres-ew1"

gcloud config set project "$PROJECT_ID"
gcloud builds submit --tag "$IMAGE" .
gcloud run jobs deploy slate-migrate \
  --image "$IMAGE" \
  --region "$REGION" \
  --command /app/slate \
  --args migrate \
  --set-cloudsql-instances "$CLOUD_SQL_INSTANCES" \
  --set-secrets DATABASE_URL=slate-database-url:latest \
  --max-retries 0 \
  --task-timeout 10m \
  --quiet
gcloud run jobs execute slate-migrate --region "$REGION" --wait --quiet
gcloud run deploy slate \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --no-invoker-iam-check \
  --set-cloudsql-instances "$CLOUD_SQL_INSTANCES" \
  --ingress all \
  --set-env-vars COOKIE_SECURE=true \
  --set-secrets DATABASE_URL=slate-database-url:latest,SESSION_SECRET=slate-session-secret:latest,INVITE_CODE=slate-invite-code:latest \
  --quiet

health_url="${HEALTH_URL:-https://slate.do/api/health}"
deployed="$(gcloud run services describe slate --region "$REGION" --format='value(spec.template.spec.containers[0].image)')"
if [ "$deployed" != "$IMAGE" ]; then
  printf 'Expected deployed image %s, got %s\n' "$IMAGE" "$deployed" >&2
  exit 1
fi
response="$(curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 --max-time 10 "$health_url")"
printf '%s\n' "$response"
grep -F '"database":"ok"' <<<"$response"
