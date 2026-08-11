UPDATE tasks
SET status = 'done'
WHERE done = true AND status <> 'done';

-- Keep the released done column through one expand/contract rollout. Old
-- revisions still read and write it while new revisions use status only.
CREATE OR REPLACE FUNCTION sync_task_done_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.done THEN
      NEW.status = 'done';
    ELSE
      NEW.done = NEW.status = 'done';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.done = NEW.status = 'done';
  ELSIF NEW.done IS DISTINCT FROM OLD.done THEN
    IF NEW.done THEN
      NEW.status = 'done';
    ELSIF OLD.status = 'done' THEN
      NEW.status = 'queued';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_sync_done_status ON tasks;
CREATE TRIGGER tasks_sync_done_status
BEFORE INSERT OR UPDATE OF done, status ON tasks
FOR EACH ROW EXECUTE FUNCTION sync_task_done_status();

DROP INDEX IF EXISTS tasks_assignee_agent_status_idx;
DROP INDEX IF EXISTS tasks_board_priority_idx;
DROP INDEX IF EXISTS tasks_bucket_completed_history_idx;
DROP INDEX IF EXISTS tasks_status_idx;

CREATE INDEX tasks_assignee_agent_status_idx
ON tasks (assignee_agent_id, status)
WHERE assignee_agent_id IS NOT NULL AND status <> 'done';

CREATE INDEX tasks_board_priority_idx
ON tasks (board_id, priority)
WHERE priority <> '' AND status <> 'done';

CREATE INDEX tasks_bucket_completed_history_idx
ON tasks (bucket_id, updated_at DESC, id DESC)
WHERE status = 'done';

COMMENT ON INDEX tasks_bucket_completed_history_idx IS
'Supports bounded, deterministic completed-card history reads without indexing card descriptions.';

CREATE INDEX tasks_status_idx
ON tasks(status)
WHERE status <> 'done';
