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
2. Set `DB_PASSWORD`, `DATABASE_URL`, and `SESSION_SECRET`.
3. Run `scripts/gcp-bootstrap.sh` once for a new project.
4. Connect the GitHub repo to Cloud Build.
5. Create the `slate-main-deploy` Cloud Build trigger for `^main$` using `cloudbuild.yaml`.
6. Run `scripts/gcp-deploy.sh` only when a manual recovery deploy is needed.

After authorizing the Cloud Build GitHub App for the repository, create the trigger once:

```bash
PROJECT_ID=slate-do-production
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
BUILD_SERVICE_ACCOUNT="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$BUILD_SERVICE_ACCOUNT" \
  --role=roles/cloudbuild.builds.viewer \
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

Every push to `main` runs the Go tests, builds and pushes a build-unique image, resolves it to an immutable digest, executes a per-commit migration job, deploys the service only after migrations pass, verifies the deployed digest, and checks `https://slate.do/api/health`. A failed test, build, migration, deploy, or health check stops the pipeline. Builds can compile in parallel, but a Cloud Storage lock serializes migrations and service deployment. After acquiring the lock, stale builds stop before changing production, so an older overlapping build cannot replace a newer release. An abandoned lock is removed only after Cloud Build confirms its owning build is no longer running. The build service account therefore needs `roles/cloudbuild.builds.viewer` in addition to its deploy, Artifact Registry, Secret Manager, logging, and Cloud Storage permissions.

The migration job and service attach the production Cloud SQL instance in Europe West 1 because `slate-database-url` uses that socket. Deploys always replace the complete required secret mapping. They add `INVITE_CODE` only when `slate-invite-code:latest` is accessible. If the live service already uses `INVITE_CODE` but that version becomes inaccessible, deployment fails instead of silently disabling early-access registration.

The production Cloud Run service is `slate` in `europe-west1`; the `slate.do` domain mapping routes to it.
The Cloud SQL instance is `slate-postgres-ew1` in `europe-west1` and uses PostgreSQL 18.
The server applies pending database migrations under a Postgres advisory lock before it begins serving traffic. A failed migration prevents the new revision from starting.
The required runtime secrets are `slate-database-url`, `slate-session-secret`, and `slate-resend-api-key`. Invite registration is off by default. To enable it, create a separate Secret Manager secret and expose its latest version to the service as `INVITE_CODE`. Never put secret values in source, command history, a URL, or a non-secret environment file.
`OWNER_EMAIL` and `OWNER_PASSWORD` remain supported as legacy aliases.

Admin credentials are only needed while running `seed-admin` and should be supplied through a secure operator environment. Do not add them to the Cloud Run service or source control.

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

Disabling a member immediately deletes all sessions and revokes all API tokens. Re-enabling permits a new password login, but does not restore revoked sessions or tokens.
