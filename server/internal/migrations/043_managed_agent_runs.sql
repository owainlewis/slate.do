ALTER TABLE tasks
ADD COLUMN execution_run_id uuid;

ALTER TABLE card_entries
ADD COLUMN run_id uuid;

CREATE INDEX card_entries_task_run_created_idx
ON card_entries (task_id, run_id, created_at, id);
