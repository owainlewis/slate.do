CREATE OR REPLACE FUNCTION maintain_task_storage_usage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	managed_by_application boolean := COALESCE(current_setting('slate.storage_quota_managed', true), '') = 'on';
BEGIN
	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		SELECT user_id INTO NEW.owner_user_id FROM boards WHERE id = NEW.board_id;
		IF NEW.owner_user_id IS NULL THEN
			RAISE EXCEPTION 'task board owner not found' USING ERRCODE = '23503';
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

COMMENT ON FUNCTION maintain_task_storage_usage() IS
'Maintains storage counters for older application versions and skips quota locking when an UPDATE leaves task ownership and measured text unchanged.';
