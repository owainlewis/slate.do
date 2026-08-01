ALTER TABLE tasks
ADD COLUMN storage_bytes bigint
GENERATED ALWAYS AS (octet_length(title) + octet_length(description)) STORED;

ALTER TABLE tasks ADD COLUMN owner_user_id uuid;

UPDATE tasks t
SET owner_user_id = b.user_id
FROM boards b
WHERE b.id = t.board_id;

ALTER TABLE tasks ALTER COLUMN owner_user_id SET NOT NULL;

CREATE TABLE account_storage_usage (
	user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	stored_tasks bigint NOT NULL DEFAULT 0 CHECK (stored_tasks >= 0),
	stored_content_bytes bigint NOT NULL DEFAULT 0 CHECK (stored_content_bytes >= 0),
	updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO account_storage_usage (user_id, stored_tasks, stored_content_bytes)
SELECT
	u.id,
	count(t.id),
	COALESCE(sum(t.storage_bytes), 0)
FROM users u
LEFT JOIN tasks t ON t.owner_user_id = u.id
GROUP BY u.id;

CREATE FUNCTION apply_account_storage_delta(target_user_id uuid, task_delta bigint, content_delta bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	current_tasks bigint;
	current_content bigint;
	task_limit bigint;
	content_limit bigint;
BEGIN
	SELECT
		CASE WHEN u.role = 'admin' OR e.plan = 'pro' THEN 10000 ELSE 500 END,
		CASE WHEN u.role = 'admin' OR e.plan = 'pro' THEN 262144000 ELSE 10485760 END
	INTO task_limit, content_limit
	FROM users u
	LEFT JOIN entitlements e ON e.user_id = u.id
	WHERE u.id = target_user_id
	FOR UPDATE OF u;

	-- A user deletion removes both the task and counter rows by cascade.
	IF NOT FOUND THEN
		RETURN;
	END IF;

	INSERT INTO account_storage_usage (user_id)
	VALUES (target_user_id)
	ON CONFLICT (user_id) DO NOTHING;

	SELECT stored_tasks, stored_content_bytes
	INTO current_tasks, current_content
	FROM account_storage_usage
	WHERE user_id = target_user_id
	FOR UPDATE;

	IF task_delta > 0 AND current_tasks + task_delta > task_limit THEN
		RAISE EXCEPTION 'stored_task_limit_reached'
			USING ERRCODE = 'P0001',
				DETAIL = format('{"code":"stored_task_limit_reached","usage":%s,"limit":%s}', current_tasks, task_limit);
	END IF;
	IF content_delta > 0 AND current_content + content_delta > content_limit THEN
		RAISE EXCEPTION 'stored_content_limit_reached'
			USING ERRCODE = 'P0001',
				DETAIL = format('{"code":"stored_content_limit_reached","usage":%s,"limit":%s}', current_content, content_limit);
	END IF;

	UPDATE account_storage_usage
	SET stored_tasks = stored_tasks + task_delta,
		stored_content_bytes = stored_content_bytes + content_delta,
		updated_at = now()
	WHERE user_id = target_user_id;
END;
$$;

CREATE FUNCTION maintain_task_storage_usage()
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

CREATE TRIGGER tasks_storage_usage
BEFORE INSERT OR DELETE OR UPDATE OF board_id, title, description ON tasks
FOR EACH ROW EXECUTE FUNCTION maintain_task_storage_usage();

COMMENT ON COLUMN tasks.storage_bytes IS
'UTF-8 bytes in quota-counted task text. Extend this expression when new user-controlled task text fields are added.';
