#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-slate-do-production}"
REGION="${REGION:-europe-west1}"
INSTANCE="${INSTANCE:-slate-postgres-ew1}"
DB_NAME="${DB_NAME:-slate}"
DB_USER="${DB_USER:-slate}"

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com sqladmin.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com
gcloud artifacts repositories create slate --repository-format=docker --location="$REGION" --description="Slate containers" || true
gcloud sql instances create "$INSTANCE" --database-version=POSTGRES_18 --edition=ENTERPRISE --tier=db-f1-micro --region="$REGION" --storage-size=10GB || true
gcloud sql databases create "$DB_NAME" --instance="$INSTANCE" || true
gcloud sql users create "$DB_USER" --instance="$INSTANCE" --password="$DB_PASSWORD" || true
printf '%s' "$DATABASE_URL" | gcloud secrets create slate-database-url --data-file=- || printf '%s' "$DATABASE_URL" | gcloud secrets versions add slate-database-url --data-file=-
printf '%s' "$SESSION_SECRET" | gcloud secrets create slate-session-secret --data-file=- || printf '%s' "$SESSION_SECRET" | gcloud secrets versions add slate-session-secret --data-file=-
printf '%s' "$RESEND_API_KEY" | gcloud secrets create slate-resend-api-key --data-file=- || printf '%s' "$RESEND_API_KEY" | gcloud secrets versions add slate-resend-api-key --data-file=-
if [ -n "${INVITE_CODE:-}" ]; then
  printf '%s' "$INVITE_CODE" | gcloud secrets create slate-invite-code --data-file=- || printf '%s' "$INVITE_CODE" | gcloud secrets versions add slate-invite-code --data-file=-
fi
PROJECT_ID="$PROJECT_ID" REGION="$REGION" INSTANCE="$INSTANCE" bash scripts/gcp-identities.sh
