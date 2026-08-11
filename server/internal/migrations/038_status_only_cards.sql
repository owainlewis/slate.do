UPDATE tasks
SET status = 'done'
WHERE done = true AND status <> 'done';

DROP INDEX IF EXISTS tasks_assignee_agent_status_idx;
DROP INDEX IF EXISTS tasks_board_priority_idx;
DROP INDEX IF EXISTS tasks_bucket_completed_history_idx;
DROP INDEX IF EXISTS tasks_status_idx;

ALTER TABLE tasks DROP COLUMN done;

CREATE INDEX tasks_assignee_agent_status_idx
ON tasks (assignee_agent_id, status)
WHERE assignee_agent_id IS NOT NULL AND status <> 'done';

CREATE INDEX tasks_board_priority_idx
ON tasks (board_id, priority)
WHERE priority <> '' AND status <> 'done';

CREATE INDEX tasks_bucket_completed_history_idx
ON tasks (bucket_id, updated_at DESC, id DESC)
WHERE status = 'done';

COMMENT ON INDEX tasks_bucket_completed_history_idx IS
'Supports bounded, deterministic completed-card history reads without indexing card descriptions.';

CREATE INDEX tasks_status_idx
ON tasks(status)
WHERE status <> 'done';
