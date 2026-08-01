CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE INDEX password_reset_tokens_used_idx
ON password_reset_tokens (used_at)
WHERE used_at IS NOT NULL;

CREATE INDEX password_reset_requests_processed_idx
ON password_reset_requests (processed_at)
WHERE processed_at IS NOT NULL;

CREATE INDEX password_reset_requests_stale_pending_idx
ON password_reset_requests (created_at)
WHERE processed_at IS NULL;

CREATE INDEX task_idempotency_keys_created_idx
ON task_idempotency_keys (created_at);

CREATE INDEX agent_credential_rotations_created_idx
ON agent_credential_rotations (created_at);

CREATE INDEX api_tokens_revoked_idx
ON api_tokens (revoked_at)
WHERE revoked_at IS NOT NULL;

CREATE INDEX agent_credentials_revoked_idx
ON agent_credentials (revoked_at)
WHERE revoked_at IS NOT NULL;
