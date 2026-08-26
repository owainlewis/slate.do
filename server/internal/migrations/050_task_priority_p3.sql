ALTER TABLE tasks DROP CONSTRAINT tasks_priority_check;

ALTER TABLE tasks
ADD CONSTRAINT tasks_priority_check
CHECK (priority IN ('', 'p0', 'p1', 'p2', 'p3'));
