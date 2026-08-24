-- Summary windows need event time, not the task's general edit time. Preserve
-- the best timestamp available for existing rows, then maintain exact times
-- for every status transition and managed run claim after this migration.
ALTER TABLE tasks
ADD COLUMN completed_at timestamptz;

UPDATE tasks
SET completed_at = updated_at
WHERE status = 'done';

CREATE TABLE task_run_starts (
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, run_id)
);

CREATE INDEX task_run_starts_owner_started_idx
ON task_run_starts (owner_user_id, started_at DESC);

CREATE INDEX task_run_starts_started_idx
ON task_run_starts (started_at);

INSERT INTO task_run_starts (owner_user_id, run_id, task_id, started_at)
SELECT owner_user_id, execution_run_id, id, updated_at
FROM tasks
WHERE execution_run_id IS NOT NULL
ON CONFLICT (owner_user_id, run_id) DO NOTHING;

CREATE OR REPLACE FUNCTION track_task_completion_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'done' AND NEW.completed_at IS NULL THEN
      NEW.completed_at = now();
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'done' THEN
      NEW.completed_at = now();
    ELSE
      NEW.completed_at = NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION record_inserted_task_run_starts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO task_run_starts (owner_user_id, run_id, task_id)
  SELECT owner_user_id, execution_run_id, id
  FROM inserted_tasks
  WHERE execution_run_id IS NOT NULL
  ON CONFLICT (owner_user_id, run_id) DO NOTHING;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION record_updated_task_run_start()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.execution_run_id IS NOT NULL
    AND NEW.execution_run_id IS DISTINCT FROM OLD.execution_run_id THEN
    INSERT INTO task_run_starts (owner_user_id, run_id, task_id)
    VALUES (NEW.owner_user_id, NEW.execution_run_id, NEW.id)
    ON CONFLICT (owner_user_id, run_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- PostgreSQL runs same-kind triggers by name. tasks_sync_done_status runs
-- before this trigger, so legacy done-only writes have their synchronized
-- status available here during the migration-to-deploy compatibility window.
CREATE TRIGGER tasks_track_completion_timestamp
BEFORE INSERT OR UPDATE OF done, status ON tasks
FOR EACH ROW EXECUTE FUNCTION track_task_completion_timestamp();

-- A statement-level insert trigger runs after every task row is visible, so
-- task_id satisfies the event table's immediate foreign key. The row-level
-- update trigger preserves run starts written by an old server revision
-- between migration and application deployment.
CREATE TRIGGER tasks_record_inserted_run_starts
AFTER INSERT ON tasks
REFERENCING NEW TABLE AS inserted_tasks
FOR EACH STATEMENT EXECUTE FUNCTION record_inserted_task_run_starts();

CREATE TRIGGER tasks_record_updated_run_start
AFTER UPDATE OF execution_run_id ON tasks
FOR EACH ROW EXECUTE FUNCTION record_updated_task_run_start();
