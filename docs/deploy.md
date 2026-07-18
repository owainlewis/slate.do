# Deploy Slate

Production target: GCP project `slate-do-production`.
Production region: `europe-west1`.

## Local

```bash
createdb slate_dev
export DATABASE_URL=postgres://localhost/slate_dev?sslmode=disable
export ADMIN_EMAIL=you@example.com
export ADMIN_PASSWORD='use-a-long-password'
just migrate
just seed-admin
just serve
```

Open `http://localhost:8080`.

## GCP

1. Set `PROJECT_ID=slate-do-production`.
2. Set `DB_PASSWORD`, `DATABASE_URL`, and `SESSION_SECRET`. `DATABASE_URL` must reference the Cloud SQL connection `slate-do-production:europe-west1:slate-postgres-ew1`.
3. Run `scripts/gcp-bootstrap.sh`.
4. Run `scripts/gcp-deploy.sh`.
5. Connect the GitHub repo to Cloud Build.
6. Create a Cloud Build trigger on pushes to `main` using `cloudbuild.yaml`.

If a Cloud Build trigger overrides substitutions, set `_REGION=europe-west1` and `_INSTANCE=slate-postgres-ew1`, or remove those overrides so the defaults in `cloudbuild.yaml` apply.
The trigger's build identity needs `roles/secretmanager.secretAccessor` on `slate-database-url` because the build verifies the secret target before deploying.
Each new revision applies pending migrations before it starts serving. A PostgreSQL advisory lock serializes concurrent migration attempts. Cloud Build initially deploys a uniquely named revision with no traffic. It promotes that revision only when its commit still matches `main`, and uses the Cloud Run service etag to reject a promotion if another build changed the service first.

## Regional migration

Do not use the bootstrap flow to replace an existing production database. For a regional move:

1. Enable automated backups and point-in-time recovery on the source Cloud SQL instance.
2. Create a cross-region read replica named `slate-postgres-ew1` in `europe-west1`.
3. Create the destination Artifact Registry repository and build a commit-tagged migration image without running the bootstrap script:

   ```sh
   gcloud artifacts repositories describe slate --project slate-do-production --location europe-west1 || \
     gcloud artifacts repositories create slate --project slate-do-production --location europe-west1 --repository-format docker
   COMMIT_SHA=$(git rev-parse HEAD)
   gcloud builds submit \
     --project slate-do-production \
     --tag "europe-west1-docker.pkg.dev/slate-do-production/slate/slate:$COMMIT_SHA" .
   ```

4. Deploy the Cloud Run service in `europe-west1` against the source database and verify the generated service URL. This is a migration-only deployment, so specify the service and database regions separately:

   ```sh
   COMMIT_SHA=$(git rev-parse HEAD)
   IMAGE_DIGEST=$(gcloud artifacts docker images describe \
     "europe-west1-docker.pkg.dev/slate-do-production/slate/slate:$COMMIT_SHA" \
     --format 'value(image_summary.digest)')
   gcloud run deploy slate \
     --project slate-do-production \
     --region europe-west1 \
     --image "europe-west1-docker.pkg.dev/slate-do-production/slate/slate@$IMAGE_DIGEST" \
     --add-cloudsql-instances slate-do-production:europe-west2:slate-postgres \
     --set-env-vars COOKIE_SECURE=true \
     --set-secrets DATABASE_URL=slate-database-url:SOURCE_VERSION,SESSION_SECRET=slate-session-secret:latest
   ```

5. Compare exact row counts for every application table.
6. Re-enable the invoker check before restricting ingress on both services. This is required because normal deployments use `--no-invoker-iam-check`:

   ```sh
   for region in europe-west2 europe-west1; do
     gcloud run services update slate \
       --project slate-do-production \
       --region "$region" \
       --invoker-iam-check \
       --ingress internal
     gcloud run services remove-iam-policy-binding slate \
       --project slate-do-production \
       --region "$region" \
       --member allUsers \
       --role roles/run.invoker || true
   done
   ```

   Verify Cloud Run request logs show zero requests and application-table row counts remain unchanged across a quiet interval before recording the source position.
7. Record `pg_current_wal_lsn()` on the quiesced source. On the replica, confirm `pg_last_wal_replay_lsn()` has reached or passed that source LSN, then compare exact row counts again and promote the replica.
8. Add a new `slate-database-url` secret version that references `slate-do-production:europe-west1:slate-postgres-ew1`.
9. Deploy the `europe-west1` service with the promoted instance attached, then explicitly restore external access and verify database reads and writes:

   ```sh
   gcloud run services update slate \
      --project slate-do-production \
      --region europe-west1 \
      --set-cloudsql-instances slate-do-production:europe-west1:slate-postgres-ew1 \
      --set-secrets DATABASE_URL=slate-database-url:DESTINATION_VERSION,SESSION_SECRET=slate-session-secret:latest \
      --ingress all \
      --no-invoker-iam-check
   ```

   Do not reopen traffic until this update succeeds and the resulting revision shows only `slate-postgres-ew1` as its Cloud SQL attachment. Using `--set-cloudsql-instances` is intentional: it removes the temporary source attachment instead of adding the destination alongside it.

10. Map the custom domain, update DNS, and verify HTTPS before treating the migration as complete.

Keep the old service restricted and the old database intact until the new region has been verified. Before writes resume, roll back by restoring the previous database secret version, attaching the old Cloud SQL instance, and reopening the old service before changing DNS. After writes resume on the promoted database, keep that database as the source of truth: roll back only the application image while it remains attached to `slate-postgres-ew1`. A database rollback after that point requires stopping writes and explicitly reconciling post-promotion data.

The Cloud Run service is `slate`.
The Cloud SQL instance is `slate-postgres-ew1` and uses PostgreSQL 18.
The required secrets are `slate-database-url` and `slate-session-secret`.
`OWNER_EMAIL` and `OWNER_PASSWORD` remain supported as legacy aliases.

Admin credentials are only needed while running `seed-admin` and should be supplied through a secure operator environment. Do not add them to the Cloud Run service or source control.
