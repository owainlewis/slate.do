-- Managed agent runs let one execution fence its own mutations. A claim records
-- the run on the task, later agent entries carry the same run, and legacy rows
-- stay null so existing agents keep their current behavior.
ALTER TABLE tasks
ADD COLUMN execution_run_id uuid;

ALTER TABLE card_entries
ADD COLUMN run_id uuid;

-- The watcher reads the entries of one exact run in creation order.
CREATE INDEX IF NOT EXISTS card_entries_task_run_created_idx
ON card_entries (task_id, run_id, created_at, id);
