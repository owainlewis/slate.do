# Operational data retention

Slate keeps customer-created boards, tasks, agent identities, entitlements, and future billing history until the customer or an explicit account workflow removes them. The daily cleanup job only removes short-lived operational records.

| Record class | Retention | Action |
| --- | --- | --- |
| Browser sessions | Until `expires_at` | Delete |
| Unused password reset tokens | Until `expires_at` | Delete |
| Used password reset tokens | 24 hours after use | Delete |
| Processed password reset requests | 24 hours after processing | Delete |
| Pending password reset requests | 7 days | Delete |
| Signup and password-reset rate-limit windows | 24 hours | Delete |
| Shared API rate-limit state | Until `expires_at` | Delete |
| Aggregated API rate-limit metrics | 30 days | Delete |
| Task-create idempotency keys | 7 days | Delete |
| Agent credential rotation idempotency keys | 7 days | Delete |
| Revoked personal API tokens | 30 days | Delete |
| Revoked agent credentials | 30 days | Delete; agent identity and task history remain |

Every path uses an indexed timestamp lookup, row locks with `SKIP LOCKED`, and a maximum of 500 rows per run. A retry is safe because each predicate depends only on immutable expiry or age. The command emits one JSON report containing the affected count and any error for every path. It continues to later paths after an individual failure, then exits unsuccessfully so Cloud Run records the failed execution.

Production deploys a single-task `slate-cleanup` Cloud Run Job and schedules it daily at 03:17 UTC. One retry is allowed. The job has its own process and database connection, so a cleanup error cannot stop or restart the serving `slate` service. Inspect recent executions and their JSON reports with:

```bash
gcloud run jobs executions list --job slate-cleanup --region europe-west1
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="slate-cleanup"' --limit 20
```

Operators can run the same idempotent cleanup locally or as a one-off job with `slate cleanup`. Repeated daily runs drain a backlog in bounded steps without long table locks.
