#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-slate-do-production}"
REGION="${REGION:-europe-west2}"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/slate/slate:manual-$(git rev-parse --short HEAD)"

gcloud config set project "$PROJECT_ID"
gcloud builds submit --tag "$IMAGE" .
gcloud run deploy slate \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --no-invoker-iam-check \
  --add-cloudsql-instances "$PROJECT_ID:$REGION:slate-postgres" \
  --set-env-vars COOKIE_SECURE=true \
  --set-secrets DATABASE_URL=slate-database-url:latest,SESSION_SECRET=slate-session-secret:latest
