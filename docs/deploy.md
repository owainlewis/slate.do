# Deploy Slate

Production target: GCP project `slate-do-production`.

## Local

```bash
createdb slate_dev
export DATABASE_URL=postgres://localhost/slate_dev?sslmode=disable
export ADMIN_EMAIL=you@example.com
export ADMIN_PASSWORD='use-a-long-password'
export INVITE_CODE='use-a-long-random-shared-code'
just migrate
just seed-admin
just serve
```

Open `http://localhost:8080`.

## GCP

1. Set `PROJECT_ID=slate-do-production`.
2. Set `DB_PASSWORD`, `DATABASE_URL`, and `SESSION_SECRET`.
3. Run `scripts/gcp-bootstrap.sh`.
4. Run `scripts/gcp-deploy.sh`.
5. Connect the GitHub repo to Cloud Build.
6. Create a Cloud Build trigger on pushes to `main` using `cloudbuild.yaml`.

The Cloud Run service is `slate`.
The Cloud SQL instance is `slate-postgres` and uses PostgreSQL 18.
The required runtime secrets are `slate-database-url` and `slate-session-secret`. Invite registration is off by default. To enable it, create a separate Secret Manager secret and expose its latest version to the service as `INVITE_CODE`. Never put the code in source, command history, a URL, or a non-secret environment file.
`OWNER_EMAIL` and `OWNER_PASSWORD` remain supported as legacy aliases.

Admin credentials are only needed while running `seed-admin` and should be supplied through a secure operator environment. Do not add them to the Cloud Run service or source control.

## Invite registration

When `INVITE_CODE` is present, `/early-access` accepts a reusable shared code and creates Pro member accounts. When it is absent or empty, both the page and registration endpoint return not found and no account can be created. Existing invited accounts do not depend on the current code.

Configure the Cloud Run service with a Secret Manager reference:

```bash
gcloud secrets create slate-invite-code --replication-policy=automatic
gcloud secrets versions add slate-invite-code --data-file=-
gcloud run services update slate --region=europe-west2 \
  --update-secrets INVITE_CODE=slate-invite-code:latest
```

Enter the secret value on standard input when prompted. To rotate it, add a new secret version and deploy a new Cloud Run revision. The old code stops working as soon as all traffic uses the new revision. To disable registration, remove the mapping and deploy a new revision:

```bash
gcloud run services update slate --region=europe-west2 \
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
