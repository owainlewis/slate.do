ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'new';
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
	CHECK (status IN ('new', 'queued', 'working', 'needs_review', 'done'));
