CREATE INDEX tasks_bucket_completed_history_idx
ON tasks(bucket_id, updated_at DESC, id DESC)
WHERE done = true;

COMMENT ON INDEX tasks_bucket_completed_history_idx IS
'Supports bounded, deterministic completed-task history reads without indexing task descriptions.';
