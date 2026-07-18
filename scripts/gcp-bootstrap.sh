#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-slate-do-production}"
REGION="${REGION:-europe-west1}"
INSTANCE="${INSTANCE:-slate-postgres-ew1}"
DB_NAME="${DB_NAME:-slate}"
DB_USER="${DB_USER:-slate}"
EXPECTED_CONNECTION="$PROJECT_ID:$REGION:$INSTANCE"

if [[ "$DATABASE_URL" != *"$EXPECTED_CONNECTION"* ]]; then
  echo "DATABASE_URL must reference $EXPECTED_CONNECTION" >&2
  exit 1
fi

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com sqladmin.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
gcloud artifacts repositories create slate --repository-format=docker --location="$REGION" --description="Slate containers" || true
gcloud sql instances create "$INSTANCE" --database-version=POSTGRES_18 --edition=ENTERPRISE --tier=db-f1-micro --region="$REGION" --storage-size=10GB || true
gcloud sql databases create "$DB_NAME" --instance="$INSTANCE" || true
gcloud sql users create "$DB_USER" --instance="$INSTANCE" --password="$DB_PASSWORD" || true
printf '%s' "$DATABASE_URL" | gcloud secrets create slate-database-url --data-file=- || printf '%s' "$DATABASE_URL" | gcloud secrets versions add slate-database-url --data-file=-
printf '%s' "$SESSION_SECRET" | gcloud secrets create slate-session-secret --data-file=- || printf '%s' "$SESSION_SECRET" | gcloud secrets versions add slate-session-secret --data-file=-
