-- Databases that ran the first version of migration 038 during development
-- may already have dropped done. Restore it for the rollout compatibility
-- window. Production databases retain it continuously through migration 038.
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS done boolean NOT NULL DEFAULT false;

UPDATE tasks
SET done = status = 'done'
WHERE done IS DISTINCT FROM (status = 'done');

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

COMMENT ON COLUMN tasks.done IS
'Rollout compatibility for pre-status-only revisions. Remove in a later deployment after old revisions are drained.';
