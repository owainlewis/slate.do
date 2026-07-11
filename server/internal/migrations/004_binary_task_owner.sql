ALTER TABLE tasks ADD COLUMN agent boolean NOT NULL DEFAULT false;

-- Only migrate assignments that already carry agent-specific workflow data.
-- A non-empty assignee alone is not enough because the old field also held human names.
UPDATE tasks
SET agent = true
WHERE agent_brief <> '';

-- Preserve the old Focus flag by moving those tasks into a Focus list.
INSERT INTO buckets (board_id, name, is_inbox, limit_count, sort_order)
SELECT bo.id,
	'Focus',
	false,
	bo.max_tasks_per_list,
	COALESCE((SELECT max(b.sort_order) + 1 FROM buckets b WHERE b.board_id = bo.id), 0)
FROM boards bo
WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.board_id = bo.id AND t.focus = true AND t.done = false)
	AND NOT EXISTS (SELECT 1 FROM buckets b WHERE b.board_id = bo.id AND lower(b.name) = 'focus');

WITH moves AS (
	SELECT t.id AS task_id,
		focus_bucket.id AS bucket_id,
		row_number() OVER (PARTITION BY focus_bucket.id ORDER BY t.sort_order, t.created_at) AS offset
	FROM tasks t
	JOIN LATERAL (
		SELECT b.id
		FROM buckets b
		WHERE b.board_id = t.board_id AND lower(b.name) = 'focus'
		ORDER BY b.sort_order, b.created_at
		LIMIT 1
	) focus_bucket ON true
	WHERE t.focus = true AND t.done = false AND t.bucket_id <> focus_bucket.id
), positioned AS (
	SELECT moves.task_id,
		moves.bucket_id,
		COALESCE((SELECT max(t.sort_order) FROM tasks t WHERE t.bucket_id = moves.bucket_id), -1) + moves.offset AS sort_order
	FROM moves
)
UPDATE tasks
SET bucket_id = positioned.bucket_id,
	sort_order = positioned.sort_order,
	updated_at = now()
FROM positioned
WHERE tasks.id = positioned.task_id;

DROP INDEX tasks_assignee_status_idx;
ALTER TABLE tasks DROP COLUMN focus;
ALTER TABLE tasks RENAME COLUMN assignee TO legacy_assignee;

CREATE INDEX tasks_agent_status_idx ON tasks(status) WHERE agent = true AND done = false;
