# Deploy Slate

Production target: GCP project `slate-do-production`.

## Local

```bash
createdb slate_dev
export DATABASE_URL=postgres://localhost/slate_dev?sslmode=disable
export ADMIN_EMAIL=you@example.com
export ADMIN_PASSWORD='use-a-long-password'
export INVITE_CODE='use-a-long-random-shared-code'
export APP_BASE_URL='http://localhost:8080'
export RESEND_API_KEY='re_...'
export RESEND_FROM='Slate <passwords@mail.slate.do>'
just migrate
just seed-admin
just serve
```

Open `http://localhost:8080`.

## GCP

1. Set `PROJECT_ID=slate-do-production`.
2. Set `DB_PASSWORD`, `DATABASE_URL`, `SESSION_SECRET`, and `RESEND_API_KEY`.
   Set `INVITE_CODE` too when invite registration should be enabled.
3. Run `scripts/gcp-bootstrap.sh` once for a new project. This creates the
   dedicated Slate service accounts and their scoped access.
4. Connect the GitHub repo to Cloud Build.
5. Create the `slate-main-deploy` Cloud Build trigger for `^main$` using `cloudbuild.yaml`.
6. Run `scripts/gcp-deploy.sh` only when a manual recovery deploy is needed.

After authorizing the Cloud Build GitHub App for the repository, create the trigger once:

```bash
PROJECT_ID=slate-do-production
BUILD_SERVICE_ACCOUNT="slate-deploy@$PROJECT_ID.iam.gserviceaccount.com"
OPERATOR_PRINCIPAL="user:$(gcloud config get-value account)"
PROJECT_ID="$PROJECT_ID" OPERATOR_PRINCIPAL="$OPERATOR_PRINCIPAL" bash scripts/gcp-identities.sh
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$BUILD_SERVICE_ACCOUNT" \
  --role=roles/cloudbuild.builds.editor \
  --condition=None
gcloud builds triggers create github \
  --project="$PROJECT_ID" \
  --region=global \
  --name=slate-main-deploy \
  --repo-owner=owainlewis \
  --repo-name=slate.do \
  --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml \
  --include-logs-with-status \
  --service-account="projects/$PROJECT_ID/serviceAccounts/$BUILD_SERVICE_ACCOUNT"
```

Every pull request and push to `main` must pass the GitHub `Required CI` check. It provisions disposable PostgreSQL 18, fails on skipped database tests, and runs the Chromium browser suite. Server test events stream while the suite runs, Go emits goroutine stacks after five minutes, each browser test stops after one minute, and GitHub stops the complete job after ten minutes. Cloud Build waits up to fifteen minutes for that exact check, so a hung CI run reaches a visible final conclusion before the deploy gate exits. It then runs the fast Go checks, builds and pushes a build-unique image, resolves it to an immutable digest, executes a per-commit migration job, deploys the service only after migrations pass, verifies the deployed digest, and checks `https://slate.do/api/health`. A failed test, build, migration, deploy, or health check stops the pipeline. Builds can compile in parallel, but a Cloud Storage lock serializes migrations and service deployment. After acquiring the lock, stale builds stop before changing production, so an older overlapping build cannot replace a newer release. An abandoned lock is removed only after Cloud Build confirms its owning build is no longer running. The deploy identity uses `roles/cloudbuild.builds.editor` to let the trigger create builds and to inspect or stop lock owners. It has `iam.serviceAccounts.actAs` on itself because the same identity triggers and executes each build. The operator creates manual builds and explicitly selects the execution identity. Artifact Registry and build-bucket access is scoped to those resources.

`main` branch protection requires a pull request and the `Required CI` check for
all users, including administrators. Repository administrators should verify
the rule after changing workflow or repository settings:

```bash
gh api repos/owainlewis/slate.do/branches/main/protection
```

The deploy also updates the independent `slate-cleanup` Cloud Run Job and its daily Cloud Scheduler trigger. Its bounded retention policy and operations are documented in [data retention](data-retention.md). A cleanup execution failure is visible in Cloud Run Jobs but does not stop the serving service.

### Production identities

Slate uses four user-managed service accounts. No public or maintenance
runtime can deploy Cloud Run resources, administer Scheduler, impersonate
another service account, or access build storage.

| Identity | Purpose | Access |
| --- | --- | --- |
| `slate-deploy` | Cloud Build and deploy | Cloud Build execution, Cloud Run and Scheduler deployment, Cloud Logging, the `slate` Artifact Registry repository, the dedicated build-lock bucket, and `actAs` only for the three runtime identities |
| `slate-web` | Public `slate` service | Cloud SQL Client conditionally restricted to `slate-postgres-ew1`; accessor on `slate-database-url`, `slate-session-secret`, `slate-resend-api-key`, and the optional `slate-invite-code` |
| `slate-maintenance` | Migration and cleanup jobs | Cloud SQL Client conditionally restricted to `slate-postgres-ew1`; accessor on `slate-database-url` only |
| `slate-scheduler` | Scheduler caller | Cloud Run Invoker on the `slate-cleanup` job only |

Cloud Build uses `slate-deploy` in both the trigger and `cloudbuild.yaml`.
Manual recovery builds also select it explicitly. Every Cloud Run service and
job deployment supplies its runtime service account explicitly.

For an existing project, stage the cutover without removing old access:

```bash
PROJECT_ID=slate-do-production bash scripts/gcp-identities.sh
```

After the new main build has deployed successfully, inspect its migration
execution and run the guarded production verification. This checks the trigger,
runtime, job, and Scheduler identities, verifies health, runs cleanup directly,
runs it through Scheduler, waits for success, and only then removes the old
Slate project roles from the default compute service account:

```bash
PROJECT_ID=slate-do-production bash scripts/gcp-finalize-identities.sh
```

Inspect the final policies with:

```bash
gcloud projects get-iam-policy slate-do-production \
  --flatten='bindings[].members' \
  --filter='bindings.members:slate-' \
  --format='table(bindings.members,bindings.role,bindings.condition.expression)'
gcloud secrets get-iam-policy slate-database-url --project=slate-do-production
gcloud run jobs get-iam-policy slate-cleanup --region=europe-west1 --project=slate-do-production
```

The role choices follow Google Cloud's guidance for
[user-specified Cloud Build accounts](https://cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts),
[Cloud Run service identities](https://cloud.google.com/run/docs/configuring/services/service-identity),
[instance-scoped Cloud SQL IAM conditions](https://cloud.google.com/sql/docs/postgres/iam-conditions),
and [authenticated Scheduler targets](https://cloud.google.com/scheduler/docs/http-target-auth).

The migration job and service attach the production Cloud SQL instance in Europe West 1 because `slate-database-url` uses that socket. Deploys always replace the complete required secret mapping. They add `INVITE_CODE` only when `slate-invite-code:latest` is accessible. If the live service already uses `INVITE_CODE` but that version becomes inaccessible, deployment fails instead of silently disabling early-access registration.

The production Cloud Run service is `slate` in `europe-west1`; the `slate.do` domain mapping routes to it.
The Cloud SQL instance is `slate-postgres-ew1` in `europe-west1` and uses PostgreSQL 18.
The server applies pending database migrations under a Postgres advisory lock before it begins serving traffic. A failed migration prevents the new revision from starting.
The required runtime secrets are `slate-database-url`, `slate-session-secret`, and `slate-resend-api-key`. Invite registration is off by default. To enable it, create a separate Secret Manager secret and expose its latest version to the service as `INVITE_CODE`. Never put secret values in source, command history, a URL, or a non-secret environment file.
`OWNER_EMAIL` and `OWNER_PASSWORD` remain supported as legacy aliases.

Admin credentials are only needed while running `seed-admin` and should be supplied through a secure operator environment. Do not add them to the Cloud Run service or source control.

## Launch capacity envelope

The paid-launch deployment uses a service-level Cloud Run maximum of 4 instances and a pool maximum of 2 Postgres connections per instance. The normal application ceiling is therefore `4 × 2 = 8` connections. Cloud Run documents its maximum as a soft bound: under normal scaling it can briefly run fewer than twice the configured maximum, and sudden spikes can exceed that. At the normal transient envelope, 7 instances × 2 connections is 14.

To make the database bound independent of Cloud Run's soft maximum, every service connection claims one of 16 Postgres advisory-lock slots when it is created. The slots are shared across every revision and instance. A seventeenth service connection is closed and its request receives the stable capacity response. Migration and operator connections do not claim app slots. The configured database allowance is 25, so the distributed application cap of 16 leaves 9 connections for the migration job, Cloud SQL internals, and operator access.

The server verifies `SHOW max_connections` at startup and refuses to run when it is below `DB_CONNECTION_ALLOWANCE`. The current values are:

```text
APP_MAX_INSTANCES=4
DB_MAX_CONNECTIONS=2
DB_CONNECTION_ALLOWANCE=25
DB_RESERVED_CONNECTIONS=9
DB_ACQUIRE_TIMEOUT=2s
DB_STATEMENT_TIMEOUT=10s
DB_IDLE_TRANSACTION_TIMEOUT=10s
DB_MAX_CONNECTION_IDLE_TIME=5m
DB_MAX_CONNECTION_LIFETIME=30m
REQUEST_TIMEOUT=15s
HTTP_IDLE_TIMEOUT=60s
```

Cloud Run has a 20-second outer request timeout and accepts 16 concurrent requests per instance. Deployment derives that outer timeout as `REQUEST_TIMEOUT` plus 5 seconds, so it cannot be configured below the app deadline. The app returns `503` with code `service_unavailable` when pool acquisition, statement execution, an idle transaction, or the 15-second request deadline reaches its limit. Pool acquisition stops after 2 seconds, Postgres stops statements after 10 seconds, and idle transactions are stopped after 10 seconds. These values leave time for a controlled response before Cloud Run terminates the request.

Cloud Build and `scripts/gcp-deploy.sh` print the effective instance, pool, connection, reserve, and concurrency values after a deploy. They also verify the service-level maximum and the pool size reported by `/api/health`. Inspect the live values at any time with:

```bash
gcloud run services describe slate \
  --project=slate-do-production \
  --region=europe-west1
```

Only raise an instance or pool limit in the same change as `DB_CONNECTION_ALLOWANCE`, after `SHOW max_connections` confirms the database can support it and the product still leaves an explicit reserve. Google recommends a service-level maximum when protecting a backing database, warns that autoscaling can exceed that maximum, and recommends keeping connection pools small: [Cloud Run maximum instances](https://cloud.google.com/run/docs/about-instance-autoscaling#exceeding_maximum_instances) and [Cloud SQL connection management](https://cloud.google.com/sql/docs/postgres/manage-connections).

### Capacity check and upgrade trigger

Set `STAGING_HEALTH_URL` to the deployed staging `/api/health` URL, then run this before a production capacity change:

```bash
REQUESTS=64 CONCURRENCY=16 scripts/check-capacity.sh "$STAGING_HEALTH_URL"
```

The check must finish with no timeout, non-2xx response, or unhealthy database response. The production deploy repeats the same bounded check after the new revision is healthy.

Upgrade Cloud SQL before increasing either application limit, and upgrade when any one of these is true:

- `database/postgresql/num_backends` is at or above 12 for 15 minutes. That is 75% of the distributed 16-connection application cap.
- Database CPU is at or above 70% for 15 minutes during representative traffic.
- Any pool-acquisition or statement timeout reaches customers during the staging capacity check or normal operation.
- The staging capacity check exceeds one second at p95, or any request fails.
- Paid traffic requires more than 4 Cloud Run instances or 2 pooled connections per instance.

The present `db-f1-micro` tier is a low-cost shared-core tier without a Cloud SQL SLA. Treat moving to a supported production tier as a paid-launch readiness trigger, even if the measured thresholds remain below their limits. Performing that upgrade is intentionally separate from this runbook change.

## Password reset email

Password reset links are single-use, expire after one hour, and revoke all browser sessions when consumed. Request responses do not reveal whether an account exists. Requests are rate-limited by both client IP and normalized email.
Email requests are written to a Postgres outbox before the generic response is returned. The Cloud Run revision keeps one instance with CPU available so its worker can deliver and retry queued mail without making valid accounts distinguishable by request latency.

Verify `mail.slate.do` as a sending domain in Resend, then store the API key in Secret Manager without putting it on the command line:

```bash
gcloud secrets create slate-resend-api-key --replication-policy=automatic
gcloud secrets versions add slate-resend-api-key --data-file=-
```

Cloud Run uses these non-secret settings:

```text
APP_BASE_URL=https://slate.do
RESEND_FROM=Slate <passwords@mail.slate.do>
```

The reset feature reports itself as temporarily unavailable when either `RESEND_API_KEY` or `RESEND_FROM` is missing. Use a verified sender domain. Resend rejects arbitrary recipients from an unverified domain.

## Invite registration

When `INVITE_CODE` is present, `/early-access` accepts a reusable shared code and creates Pro member accounts. When it is absent or empty, both the page and registration endpoint return not found and no account can be created. Existing invited accounts do not depend on the current code.

Configure the Cloud Run service with a Secret Manager reference:

```bash
gcloud secrets create slate-invite-code --replication-policy=automatic
gcloud secrets versions add slate-invite-code --data-file=-
gcloud run services update slate --region=europe-west1 \
  --update-secrets INVITE_CODE=slate-invite-code:latest
```

Enter the secret value on standard input when prompted. To rotate it, add a new secret version and deploy a new Cloud Run revision. The old code stops working as soon as all traffic uses the new revision. To disable registration, remove the mapping and deploy a new revision:

```bash
gcloud run services update slate --region=europe-west1 \
  --remove-secrets INVITE_CODE
```

Registration attempts are limited by both client IP and normalized email in Postgres, so the limit is shared by all Cloud Run instances. The submitted password and invite code are never logged or stored. Only a password hash is stored; the entitlement records `invite_code` as its source.

## Member account operations

Run account commands from a secure operator environment with `DATABASE_URL` set. They do not expose an HTTP admin API.

```bash
go run ./server/cmd/slate accounts list
go run ./server/cmd/slate accounts disable person@example.com
go run ./server/cmd/slate accounts enable person@example.com
```

Disabling a member immediately deletes all sessions and revokes all API and agent tokens. Re-enabling permits a new password login, but does not restore revoked sessions or tokens.
