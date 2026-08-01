# API rate limits

Slate enforces rolling 60-second limits in PostgreSQL so every Cloud Run instance shares the same state. Each admitted timestamp is held in a bounded array under a row lock. Account and credential rows are checked in one transaction, so concurrent instances cannot admit a request at one scope after the other scope is full.

## Launch defaults

| Route class | Scope | Requests per rolling minute |
| --- | --- | ---: |
| Authenticated reads | Account and browser session or API token | 120 |
| Authenticated writes | Account and browser session or API token | 60 |
| Public authentication | Hashed client IP | 20 |

Agent credentials use the API-token scope. Health checks, static files, and logout are not limited. Logout remains available so a user can always end a browser session. Invalid unauthenticated resource requests fail before application data is read.

The public limit covers login, invite registration, password-reset request and confirmation, and unauthenticated `/api/v1/me`. Existing signup and password-reset abuse controls remain active after this shared limit and keep their stricter, longer windows.

An admitted response includes `RateLimit-Limit` and `RateLimit-Remaining`. A rejected request returns HTTP 429, `Retry-After`, and:

```json
{"code":"rate_limit_exceeded","error":"Too many requests. Retry later."}
```

Credentials, raw session IDs, IP addresses, passwords, and task content are never stored in rate-limit state or metrics. Scope keys are SHA-256 hashes before they reach the rate-limit tables.

## Agent polling

Poll no faster than once every five seconds while work is active. That is 12 reads per minute, one tenth of the default read allowance. Slow down when idle, add jitter when several agents start together, and always wait for `Retry-After` after a 429 response.

## Incident controls

Operators can tighten or restore all thresholds immediately with SQL. No application deploy or instance restart is required:

```sql
UPDATE api_rate_limit_settings
SET authenticated_read_limit = 120,
    authenticated_write_limit = 60,
    public_auth_limit = 20,
    updated_at = now()
WHERE singleton = true;
```

All limits must remain positive. A lower value applies to the next request on every instance.

## Measurement and expiry

Allowed and rejected limiter decisions are counted per minute and route class in `api_rate_limit_metrics`. Counters use 32 internal shards so measurement does not serialize unrelated customers:

```sql
SELECT bucket_start, route_class, outcome, sum(request_count) AS request_count
FROM api_rate_limit_metrics
WHERE bucket_start >= now() - interval '1 hour'
GROUP BY bucket_start, route_class, outcome
ORDER BY bucket_start DESC, route_class, outcome;
```

Each state row has an `expires_at` value. Every limiter transaction removes up to 100 expired rows through the expiry index before checking the current request. Active timestamps at least 60 seconds old are discarded before counting, so state resets at the rolling-window boundary even before physical cleanup reaches a row.
