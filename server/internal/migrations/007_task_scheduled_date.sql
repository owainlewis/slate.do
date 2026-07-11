ALTER TABLE tasks RENAME COLUMN legacy_due_date TO scheduled_date;
COMMENT ON COLUMN tasks.scheduled_date IS 'Optional date when the task is planned.';
