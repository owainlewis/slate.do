#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-slate-do-production}"
REGION="${REGION:-europe-west1}"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/slate/slate:manual-$(git rev-parse --short HEAD)"
CLOUD_SQL_INSTANCES="$PROJECT_ID:$REGION:slate-postgres-ew1"
BUILD_BUCKET="${BUILD_BUCKET:-gs://${PROJECT_ID}-slate-build}"
DEPLOY_SERVICE_ACCOUNT="slate-deploy@$PROJECT_ID.iam.gserviceaccount.com"
WEB_SERVICE_ACCOUNT="slate-web@$PROJECT_ID.iam.gserviceaccount.com"
MAINTENANCE_SERVICE_ACCOUNT="slate-maintenance@$PROJECT_ID.iam.gserviceaccount.com"
SCHEDULER_SERVICE_ACCOUNT="slate-scheduler@$PROJECT_ID.iam.gserviceaccount.com"
RUNTIME_SECRETS="DATABASE_URL=slate-database-url:latest,SESSION_SECRET=slate-session-secret:latest,RESEND_API_KEY=slate-resend-api-key:latest"
MAX_INSTANCES="${MAX_INSTANCES:-4}"
DB_MAX_CONNECTIONS="${DB_MAX_CONNECTIONS:-2}"
DB_CONNECTION_ALLOWANCE="${DB_CONNECTION_ALLOWANCE:-25}"
DB_RESERVED_CONNECTIONS="${DB_RESERVED_CONNECTIONS:-9}"
DB_ACQUIRE_TIMEOUT="${DB_ACQUIRE_TIMEOUT:-2s}"
DB_STATEMENT_TIMEOUT="${DB_STATEMENT_TIMEOUT:-10s}"
DB_IDLE_TRANSACTION_TIMEOUT="${DB_IDLE_TRANSACTION_TIMEOUT:-10s}"
DB_MAX_CONNECTION_IDLE_TIME="${DB_MAX_CONNECTION_IDLE_TIME:-5m}"
DB_MAX_CONNECTION_LIFETIME="${DB_MAX_CONNECTION_LIFETIME:-30m}"
REQUEST_TIMEOUT_SECONDS="${REQUEST_TIMEOUT_SECONDS:-15}"
HTTP_IDLE_TIMEOUT="${HTTP_IDLE_TIMEOUT:-60s}"
CONCURRENCY="${CONCURRENCY:-16}"
sh scripts/validate-capacity.sh "$MAX_INSTANCES" "$DB_MAX_CONNECTIONS" "$DB_CONNECTION_ALLOWANCE" "$DB_RESERVED_CONNECTIONS" "$REQUEST_TIMEOUT_SECONDS"
RUNTIME_ENV="COOKIE_SECURE=true,APP_BASE_URL=https://slate.do,RESEND_FROM=Slate <passwords@mail.slate.do>,APP_MAX_INSTANCES=$MAX_INSTANCES,DB_MAX_CONNECTIONS=$DB_MAX_CONNECTIONS,DB_CONNECTION_ALLOWANCE=$DB_CONNECTION_ALLOWANCE,DB_RESERVED_CONNECTIONS=$DB_RESERVED_CONNECTIONS,DB_ACQUIRE_TIMEOUT=$DB_ACQUIRE_TIMEOUT,DB_STATEMENT_TIMEOUT=$DB_STATEMENT_TIMEOUT,DB_IDLE_TRANSACTION_TIMEOUT=$DB_IDLE_TRANSACTION_TIMEOUT,DB_MAX_CONNECTION_IDLE_TIME=$DB_MAX_CONNECTION_IDLE_TIME,DB_MAX_CONNECTION_LIFETIME=$DB_MAX_CONNECTION_LIFETIME,REQUEST_TIMEOUT=${REQUEST_TIMEOUT_SECONDS}s,HTTP_IDLE_TIMEOUT=$HTTP_IDLE_TIMEOUT"

gcloud config set project "$PROJECT_ID"
gcloud builds submit --tag "$IMAGE" \
  --service-account "projects/$PROJECT_ID/serviceAccounts/$DEPLOY_SERVICE_ACCOUNT" \
  --gcs-log-dir "$BUILD_BUCKET/manual-logs" \
  --gcs-source-staging-dir "$BUILD_BUCKET/manual-source" .
existing_service="$(gcloud run services list --region "$REGION" --filter='metadata.name=slate' --format='value(metadata.name)')"
existing_env_names=""
if [ "$existing_service" = slate ]; then
  existing_env_names="$(gcloud run services describe slate --region "$REGION" --format='value(spec.template.spec.containers[0].env[].name)')"
fi
invite_secret_state="$(gcloud secrets versions describe latest --secret=slate-invite-code --format='value(state)' 2>/dev/null || true)"
if [ "$invite_secret_state" = ENABLED ]; then
  RUNTIME_SECRETS="$RUNTIME_SECRETS,INVITE_CODE=slate-invite-code:latest"
elif printf '%s' "$existing_env_names" | tr ';' '\n' | grep -Fx INVITE_CODE >/dev/null; then
  printf '%s\n' 'The live service uses INVITE_CODE, but slate-invite-code:latest is not enabled or accessible' >&2
  exit 1
fi
gcloud run jobs deploy slate-migrate \
  --image "$IMAGE" \
  --region "$REGION" \
  --command /app/slate \
  --args migrate \
  --service-account "$MAINTENANCE_SERVICE_ACCOUNT" \
  --set-cloudsql-instances "$CLOUD_SQL_INSTANCES" \
  --set-secrets DATABASE_URL=slate-database-url:latest \
  --set-env-vars "APP_MAX_INSTANCES=1,DB_MAX_CONNECTIONS=1,DB_CONNECTION_ALLOWANCE=$DB_CONNECTION_ALLOWANCE,DB_RESERVED_CONNECTIONS=$DB_RESERVED_CONNECTIONS,DB_ACQUIRE_TIMEOUT=$DB_ACQUIRE_TIMEOUT,DB_STATEMENT_TIMEOUT=$DB_STATEMENT_TIMEOUT,DB_IDLE_TRANSACTION_TIMEOUT=$DB_IDLE_TRANSACTION_TIMEOUT,DB_MAX_CONNECTION_IDLE_TIME=$DB_MAX_CONNECTION_IDLE_TIME,DB_MAX_CONNECTION_LIFETIME=$DB_MAX_CONNECTION_LIFETIME,REQUEST_TIMEOUT=${REQUEST_TIMEOUT_SECONDS}s,HTTP_IDLE_TIMEOUT=$HTTP_IDLE_TIMEOUT" \
  --max-retries 0 \
  --task-timeout 10m \
  --quiet
effective_migration_identity="$(gcloud run jobs describe slate-migrate --region "$REGION" --format='value(spec.template.spec.template.spec.serviceAccountName)')"
if [ "$effective_migration_identity" != "$MAINTENANCE_SERVICE_ACCOUNT" ]; then
  printf 'Expected migration identity %s, got %s\n' "$MAINTENANCE_SERVICE_ACCOUNT" "$effective_migration_identity" >&2
  exit 1
fi
gcloud run jobs execute slate-migrate --region "$REGION" --wait --quiet
gcloud run deploy slate \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --service-account "$WEB_SERVICE_ACCOUNT" \
  --no-invoker-iam-check \
  --no-cpu-throttling \
  --min 1 \
  --max "$MAX_INSTANCES" \
  --concurrency "$CONCURRENCY" \
  --timeout "$((REQUEST_TIMEOUT_SECONDS + 5))s" \
  --set-cloudsql-instances "$CLOUD_SQL_INSTANCES" \
  --ingress all \
  --set-env-vars "$RUNTIME_ENV" \
  --set-secrets "$RUNTIME_SECRETS" \
  --quiet

health_url="${HEALTH_URL:-https://slate.do/api/health}"
deployed="$(gcloud run services describe slate --region "$REGION" --format='value(spec.template.spec.containers[0].image)')"
if [ "$deployed" != "$IMAGE" ]; then
  printf 'Expected deployed image %s, got %s\n' "$IMAGE" "$deployed" >&2
  exit 1
fi
effective_max="$(gcloud run services describe slate --region "$REGION" --format="value(metadata.annotations.'run.googleapis.com/maxScale')")"
if [ "$effective_max" != "$MAX_INSTANCES" ]; then
  printf 'Expected maximum instances %s, got %s\n' "$MAX_INSTANCES" "$effective_max" >&2
  exit 1
fi
effective_web_identity="$(gcloud run services describe slate --region "$REGION" --format='value(spec.template.spec.serviceAccountName)')"
if [ "$effective_web_identity" != "$WEB_SERVICE_ACCOUNT" ]; then
  printf 'Expected web identity %s, got %s\n' "$WEB_SERVICE_ACCOUNT" "$effective_web_identity" >&2
  exit 1
fi
response="$(curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 --max-time 10 "$health_url")"
printf '%s\n' "$response"
grep -F '"database":"ok"' <<<"$response"
grep -F "\"databaseMaxConnections\":$DB_MAX_CONNECTIONS" <<<"$response"
grep -F "\"applicationConnectionLimit\":$((DB_CONNECTION_ALLOWANCE - DB_RESERVED_CONNECTIONS))" <<<"$response"
printf 'Effective capacity: max instances=%s, DB connections/instance=%s, normal app connections=%s, distributed app cap=%s, DB reserve=%s, concurrency/instance=%s\n' \
  "$effective_max" "$DB_MAX_CONNECTIONS" "$((effective_max * DB_MAX_CONNECTIONS))" \
  "$((DB_CONNECTION_ALLOWANCE - DB_RESERVED_CONNECTIONS))" "$DB_RESERVED_CONNECTIONS" "$CONCURRENCY"
REQUESTS=64 CONCURRENCY=16 sh scripts/check-capacity.sh "$health_url"

gcloud run jobs deploy slate-cleanup \
  --image "$IMAGE" \
  --region "$REGION" \
  --command /app/slate \
  --args cleanup \
  --service-account "$MAINTENANCE_SERVICE_ACCOUNT" \
  --set-cloudsql-instances "$CLOUD_SQL_INSTANCES" \
  --set-secrets DATABASE_URL=slate-database-url:latest \
  --set-env-vars "APP_MAX_INSTANCES=1,DB_MAX_CONNECTIONS=1,DB_CONNECTION_ALLOWANCE=$DB_CONNECTION_ALLOWANCE,DB_RESERVED_CONNECTIONS=$DB_RESERVED_CONNECTIONS,DB_ACQUIRE_TIMEOUT=$DB_ACQUIRE_TIMEOUT,DB_STATEMENT_TIMEOUT=$DB_STATEMENT_TIMEOUT,DB_IDLE_TRANSACTION_TIMEOUT=$DB_IDLE_TRANSACTION_TIMEOUT,DB_MAX_CONNECTION_IDLE_TIME=$DB_MAX_CONNECTION_IDLE_TIME,DB_MAX_CONNECTION_LIFETIME=$DB_MAX_CONNECTION_LIFETIME,REQUEST_TIMEOUT=${REQUEST_TIMEOUT_SECONDS}s,HTTP_IDLE_TIMEOUT=$HTTP_IDLE_TIMEOUT" \
  --tasks 1 \
  --parallelism 1 \
  --max-retries 1 \
  --task-timeout 5m \
  --quiet
effective_cleanup_identity="$(gcloud run jobs describe slate-cleanup --region "$REGION" --format='value(spec.template.spec.template.spec.serviceAccountName)')"
if [ "$effective_cleanup_identity" != "$MAINTENANCE_SERVICE_ACCOUNT" ]; then
  printf 'Expected cleanup identity %s, got %s\n' "$MAINTENANCE_SERVICE_ACCOUNT" "$effective_cleanup_identity" >&2
  exit 1
fi
cleanup_uri="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/slate-cleanup:run"
gcloud run jobs add-iam-policy-binding slate-cleanup --region "$REGION" \
  --member="serviceAccount:$SCHEDULER_SERVICE_ACCOUNT" --role=roles/run.invoker --quiet
if gcloud scheduler jobs describe slate-cleanup --location "$REGION" >/dev/null 2>&1; then
  scheduler_action=update
else
  scheduler_action=create
fi
gcloud scheduler jobs "$scheduler_action" http slate-cleanup \
  --location "$REGION" --schedule "17 3 * * *" --time-zone "Etc/UTC" \
  --uri "$cleanup_uri" --http-method POST \
  --oauth-service-account-email "$SCHEDULER_SERVICE_ACCOUNT" \
  --oauth-token-scope "https://www.googleapis.com/auth/cloud-platform" \
  --attempt-deadline 300s --quiet
effective_scheduler_identity="$(gcloud scheduler jobs describe slate-cleanup --location "$REGION" --format='value(httpTarget.oauthToken.serviceAccountEmail)')"
if [ "$effective_scheduler_identity" != "$SCHEDULER_SERVICE_ACCOUNT" ]; then
  printf 'Expected Scheduler identity %s, got %s\n' "$SCHEDULER_SERVICE_ACCOUNT" "$effective_scheduler_identity" >&2
  exit 1
fi
