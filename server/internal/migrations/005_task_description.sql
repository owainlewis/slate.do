ALTER TABLE tasks ADD COLUMN description text NOT NULL DEFAULT '';

UPDATE tasks
SET description = CASE
	WHEN trim(notes) <> '' AND trim(agent_brief) <> '' THEN notes || E'\n\n' || agent_brief
	WHEN trim(notes) <> '' THEN notes
	ELSE agent_brief
END;

DROP INDEX tasks_agent_status_idx;
ALTER TABLE tasks DROP COLUMN agent;
ALTER TABLE tasks RENAME COLUMN due_date TO legacy_due_date;
ALTER TABLE tasks DROP COLUMN notes;
ALTER TABLE tasks DROP COLUMN agent_brief;

COMMENT ON COLUMN tasks.legacy_assignee IS 'Temporary migration-only preservation; not part of the task model.';
COMMENT ON COLUMN tasks.legacy_due_date IS 'Temporary migration-only preservation; not part of the task model.';

CREATE INDEX tasks_status_idx ON tasks(status) WHERE done = false;
