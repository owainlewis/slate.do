-- Board and list creation locks the account row before checking entitlements.
-- Repair only accounts that are not being written during this rolling deploy.
-- A skipped account is repaired transactionally by its next Inbox capture.
CREATE TEMP TABLE IF NOT EXISTS slate_inbox_backfill_users (
	id uuid PRIMARY KEY
) ON COMMIT DROP;
TRUNCATE slate_inbox_backfill_users;

WITH candidates AS (
	SELECT u.id
	FROM users u
	WHERE NOT EXISTS (
		SELECT 1
		FROM boards existing_board
		JOIN buckets existing_list ON existing_list.board_id = existing_board.id
		WHERE existing_board.user_id = u.id
			AND existing_list.is_inbox = true
	)
	ORDER BY u.id
	FOR UPDATE OF u SKIP LOCKED
)
INSERT INTO slate_inbox_backfill_users (id)
SELECT id FROM candidates;

INSERT INTO boards (user_id, name, sort_order)
SELECT u.id, 'Today', 0
FROM slate_inbox_backfill_users u
WHERE NOT EXISTS (
	SELECT 1
	FROM boards existing_board
	WHERE existing_board.user_id = u.id
);

WITH first_board AS (
	SELECT DISTINCT ON (b.user_id)
		b.user_id,
		b.id,
		b.max_tasks_per_list
	FROM boards b
	JOIN slate_inbox_backfill_users backfill_user ON backfill_user.id = b.user_id
	ORDER BY b.user_id, b.sort_order, b.created_at, b.id
)
INSERT INTO buckets (board_id, name, goal, is_inbox, limit_count, sort_order)
SELECT
	first_board.id,
	'Inbox',
	'Capture now, organise later',
	true,
	first_board.max_tasks_per_list,
	0
FROM first_board
WHERE NOT EXISTS (
	SELECT 1
	FROM boards existing_board
	JOIN buckets existing_list ON existing_list.board_id = existing_board.id
	WHERE existing_board.user_id = first_board.user_id
);

WITH first_list AS (
	SELECT DISTINCT ON (b.user_id) l.id
	FROM boards b
	JOIN slate_inbox_backfill_users backfill_user ON backfill_user.id = b.user_id
	JOIN buckets l ON l.board_id = b.id
	WHERE NOT EXISTS (
		SELECT 1
		FROM boards existing_board
		JOIN buckets existing_list ON existing_list.board_id = existing_board.id
		WHERE existing_board.user_id = b.user_id
			AND existing_list.is_inbox = true
	)
	ORDER BY b.user_id, b.sort_order, b.created_at, b.id, l.sort_order, l.created_at, l.id
)
UPDATE buckets
SET is_inbox = true,
	updated_at = now()
WHERE id IN (SELECT id FROM first_list);
