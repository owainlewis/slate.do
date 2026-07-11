ALTER TABLE buckets
ADD COLUMN goal text NOT NULL DEFAULT '';

ALTER TABLE tasks
ADD COLUMN kind text NOT NULL DEFAULT 'item' CHECK (kind IN ('item', 'action')),
ADD COLUMN parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE;

-- Everything created before this migration was explicitly created as a task.
UPDATE tasks SET kind = 'action';

CREATE INDEX tasks_parent_order_idx ON tasks(parent_task_id, sort_order, created_at);
