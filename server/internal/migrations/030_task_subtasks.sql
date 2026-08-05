ALTER TABLE tasks
ADD COLUMN parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
ADD CONSTRAINT tasks_not_own_parent_check CHECK (parent_task_id IS NULL OR parent_task_id <> id);

CREATE INDEX tasks_parent_order_idx
ON tasks (parent_task_id, sort_order, created_at)
WHERE parent_task_id IS NOT NULL;
