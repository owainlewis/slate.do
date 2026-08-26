-- Kanban columns are workflow statuses, while sort_order belongs to a list.
-- Keep a separate account-wide order so the All tasks board and list-scoped
-- boards can show the same stable sequence without changing list ordering.

ALTER TABLE tasks ADD COLUMN board_sort_order bigint;

WITH ranked AS (
	SELECT id,
		row_number() OVER (
			PARTITION BY owner_user_id,
				CASE WHEN status IN ('new', 'queued') THEN 'todo' ELSE status END
			ORDER BY created_at DESC, id DESC
		) - 1 AS board_sort_order
	FROM tasks
	WHERE parent_task_id IS NULL
)
UPDATE tasks
SET board_sort_order = ranked.board_sort_order
FROM ranked
WHERE tasks.id = ranked.id;

UPDATE tasks SET board_sort_order = sort_order WHERE board_sort_order IS NULL;
ALTER TABLE tasks ALTER COLUMN board_sort_order SET NOT NULL;

CREATE SEQUENCE task_board_order_sequence;
ALTER SEQUENCE task_board_order_sequence OWNED BY tasks.board_sort_order;
SELECT setval(
	'task_board_order_sequence',
	COALESCE((SELECT max(board_sort_order) + 1 FROM tasks), 1),
	false
);
ALTER TABLE tasks ALTER COLUMN board_sort_order SET DEFAULT nextval('task_board_order_sequence');

CREATE INDEX tasks_owner_board_order_idx ON tasks (
	owner_user_id,
	(CASE WHEN status IN ('new', 'queued') THEN 'todo' ELSE status END),
	board_sort_order,
	created_at DESC,
	id DESC
) WHERE parent_task_id IS NULL;

-- Status changes can come from the board, task detail, agents, or managed
-- runs. Put a task at the end of its destination column for every path. An
-- explicit board reorder can then place it more precisely in the same
-- transaction.
CREATE OR REPLACE FUNCTION maintain_task_board_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	destination_column text;
	previous_column text;
BEGIN
	destination_column := CASE WHEN NEW.status IN ('new', 'queued') THEN 'todo' ELSE NEW.status END;
	previous_column := CASE WHEN OLD.status IN ('new', 'queued') THEN 'todo' ELSE OLD.status END;

	IF NEW.parent_task_id IS NULL
		AND (OLD.parent_task_id IS NOT NULL OR previous_column IS DISTINCT FROM destination_column) THEN
		NEW.board_sort_order := nextval('task_board_order_sequence');
	END IF;

	RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_board_order
BEFORE UPDATE OF status, parent_task_id ON tasks
FOR EACH ROW EXECUTE FUNCTION maintain_task_board_order();
