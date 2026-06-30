# Deploy Slate

Production target: GCP project `slate-do-production`.

## Local

```bash
createdb slate_dev
export DATABASE_URL=postgres://localhost/slate_dev?sslmode=disable
export OWNER_EMAIL=you@example.com
export OWNER_PASSWORD='use-a-long-password'
just migrate
just seed-owner
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
The Cloud SQL instance is `slate-postgres`.
The required secrets are `slate-database-url` and `slate-session-secret`.
The owner password is stored as `slate-owner-password` after production seeding.
