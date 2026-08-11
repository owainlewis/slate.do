-- The first development draft of migration 039 derived legacy request hashes
-- from mutable task rows. Those hashes are not reliable create identities.
-- Preserve NULL as the explicit marker for keys created before migration 039.
UPDATE task_idempotency_keys
SET request_data_hash = NULL
WHERE created_at < COALESCE(
	(SELECT applied_at FROM schema_migrations WHERE version = '039_task_idempotency_request_data'),
	now()
);

COMMENT ON COLUMN task_idempotency_keys.request_data_hash IS
'One-way hash of the immutable normalized create request. NULL marks a key created before this identity was captured; mutable task data must never be used to backfill it.';
