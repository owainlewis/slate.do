#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-slate-do-production}"
REGION="${REGION:-europe-west1}"
INSTANCE="${INSTANCE:-slate-postgres-ew1}"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/slate/slate:manual-$(git rev-parse --short HEAD)"
EXPECTED_CONNECTION="$PROJECT_ID:$REGION:$INSTANCE"

gcloud config set project "$PROJECT_ID"
if ! gcloud secrets versions access latest --secret=slate-database-url | grep -Fq "$EXPECTED_CONNECTION"; then
  echo "slate-database-url must reference $EXPECTED_CONNECTION" >&2
  exit 1
fi
gcloud builds submit --tag "$IMAGE" .
gcloud run deploy slate \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --no-invoker-iam-check \
  --ingress all \
  --set-cloudsql-instances "$PROJECT_ID:$REGION:$INSTANCE" \
  --set-env-vars COOKIE_SECURE=true \
  --set-secrets DATABASE_URL=slate-database-url:latest,SESSION_SECRET=slate-session-secret:latest
