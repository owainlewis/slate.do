ALTER TABLE tasks ADD COLUMN priority text NOT NULL DEFAULT ''
CHECK (priority IN ('', 'p0', 'p1', 'p2'));

COMMENT ON COLUMN tasks.priority IS 'Optional cross-list priority. Empty string means unset, which is the default for most items.';

CREATE INDEX tasks_board_priority_idx
ON tasks (board_id, priority)
WHERE priority <> '' AND done = false;
