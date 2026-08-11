ALTER TABLE task_idempotency_keys
ADD COLUMN request_data_hash text;

CREATE OR REPLACE FUNCTION set_task_idempotency_request_data_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.request_data_hash IS NULL AND NEW.task_id IS NOT NULL THEN
		SELECT encode(sha256(convert_to(jsonb_build_object(
		'title', task.title,
		'description', task.description,
		'scheduledDate', COALESCE(task.scheduled_date::text, ''),
		'kind', task.kind,
		'assigneeAgentId', COALESCE(task.assignee_agent_id::text, ''),
		'parentTaskId', COALESCE(task.parent_task_id::text, '')
		)::text, 'UTF8')), 'hex')
		INTO NEW.request_data_hash
		FROM tasks task
		WHERE task.id = NEW.task_id;
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER task_idempotency_request_data_hash_insert
BEFORE INSERT ON task_idempotency_keys
FOR EACH ROW
EXECUTE FUNCTION set_task_idempotency_request_data_hash();

COMMENT ON COLUMN task_idempotency_keys.request_data_hash IS
'One-way hash of the immutable normalized create request. NULL marks a key created before this identity was captured; mutable task data must never be used to backfill it.';
