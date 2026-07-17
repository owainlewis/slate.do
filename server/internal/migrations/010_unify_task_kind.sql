UPDATE tasks
SET kind = 'action';

ALTER TABLE tasks
ALTER COLUMN kind SET DEFAULT 'action';

ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS tasks_kind_check;

ALTER TABLE tasks
ADD CONSTRAINT tasks_kind_check CHECK (kind = 'action');
