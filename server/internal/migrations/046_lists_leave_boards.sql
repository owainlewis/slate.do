-- Step two of collapsing boards into lists: boards stop being the parent.
--
-- Lists carry their own owner now, so board_id has nothing left to say about
-- who a list belongs to. It becomes optional, and the trigger that derived
-- ownership from it goes, because the server writes user_id itself from here
-- on. That trigger existed to protect the column from writers that predated
-- it; after this migration there are none.
--
-- The boards table and both board_id columns stay until the step that drops
-- them, so the previous revision still finds the data it reads if we roll back.

-- A board's max_tasks_per_list shadowed buckets.limit_count at read time, so
-- the board value is the one people actually saw. A list already has a limit
-- of its own, so put the visible number there rather than inventing a new home
-- for it.
UPDATE buckets
SET limit_count = boards.max_tasks_per_list, updated_at = now()
FROM boards
WHERE boards.id = buckets.board_id AND buckets.limit_count <> boards.max_tasks_per_list;

DROP TRIGGER buckets_inherit_board_owner_trigger ON buckets;
DROP FUNCTION buckets_inherit_board_owner();

ALTER TABLE buckets ALTER COLUMN board_id DROP NOT NULL;
ALTER TABLE tasks ALTER COLUMN board_id DROP NOT NULL;

-- Every board carried its own Inbox, so an account with three boards has three
-- of them, and pooling the lists would show all three. Keep the oldest and
-- demote the rest to ordinary lists. Nothing moves: their tasks stay where
-- they are, under a list that is no longer the capture target.
UPDATE buckets
SET is_inbox = false, updated_at = now()
WHERE is_inbox
	AND id <> (
		SELECT keep.id
		FROM buckets keep
		WHERE keep.user_id = buckets.user_id AND keep.is_inbox
		ORDER BY keep.created_at, keep.id
		LIMIT 1
	);

-- Now that one account means one Inbox, say so in the schema. Universal
-- capture reads this on every write.
CREATE UNIQUE INDEX buckets_one_inbox_per_user_idx ON buckets (user_id) WHERE is_inbox;

-- A task's owner came from its board. Take it from its list instead, which is
-- the same account and outlives the board. The quota accounting around it is
-- unchanged.
CREATE OR REPLACE FUNCTION maintain_task_storage_usage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	managed_by_application boolean := COALESCE(current_setting('slate.storage_quota_managed', true), '') = 'on';
BEGIN
	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		SELECT user_id INTO NEW.owner_user_id FROM buckets WHERE id = NEW.bucket_id;
		IF NEW.owner_user_id IS NULL THEN
			RAISE EXCEPTION 'task list owner not found' USING ERRCODE = '23503';
		END IF;
	END IF;

	-- PostgreSQL fires an UPDATE OF trigger when a column appears in SET, even
	-- when its value is unchanged. Status and metadata updates use a full-row
	-- assignment, so return before taking the quota lock when measured storage
	-- and ownership did not actually change.
	IF TG_OP = 'UPDATE'
		AND OLD.owner_user_id IS NOT DISTINCT FROM NEW.owner_user_id
		AND OLD.title IS NOT DISTINCT FROM NEW.title
		AND OLD.description IS NOT DISTINCT FROM NEW.description THEN
		RETURN NEW;
	END IF;

	IF managed_by_application THEN
		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'INSERT' THEN
		PERFORM apply_account_storage_delta(NEW.owner_user_id, 1, octet_length(NEW.title) + octet_length(NEW.description));
	ELSIF TG_OP = 'DELETE' THEN
		PERFORM apply_account_storage_delta(OLD.owner_user_id, -1, -OLD.storage_bytes);
	ELSIF OLD.owner_user_id = NEW.owner_user_id THEN
		PERFORM apply_account_storage_delta(NEW.owner_user_id, 0,
			(octet_length(NEW.title) + octet_length(NEW.description)) - OLD.storage_bytes);
	ELSE
		PERFORM apply_account_storage_delta(OLD.owner_user_id, -1, -OLD.storage_bytes);
		PERFORM apply_account_storage_delta(NEW.owner_user_id, 1, octet_length(NEW.title) + octet_length(NEW.description));
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;

-- IF EXISTS because the trigger has been dropped by hand on at least one
-- database. Recreating it unconditionally puts every database on the same
-- definition.
DROP TRIGGER IF EXISTS tasks_storage_usage ON tasks;
CREATE TRIGGER tasks_storage_usage
BEFORE INSERT OR DELETE OR UPDATE OF bucket_id, title, description ON tasks
FOR EACH ROW EXECUTE FUNCTION maintain_task_storage_usage();

-- The board is gone from these reads, so their indexes lose it too: the task
-- list, the completed history, and an agent's own queue.
CREATE INDEX tasks_owner_recent_idx ON tasks (owner_user_id, created_at DESC, id DESC);
CREATE INDEX tasks_owner_completed_idx ON tasks (owner_user_id, updated_at DESC, id DESC) WHERE status = 'done';
CREATE INDEX tasks_owner_agent_idx ON tasks (owner_user_id, assignee_agent_id) WHERE assignee_agent_id IS NOT NULL;
