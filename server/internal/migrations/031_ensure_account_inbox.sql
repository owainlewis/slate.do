-- Board and list writes lock the account row before checking entitlements.
-- Follow the same order so a write that already passed its count check cannot
-- race this backfill and create a second default after the migration commits.
SELECT id
FROM users
ORDER BY id
FOR UPDATE;

-- The migration runs while the previous service revision is still live. Block
-- concurrent board and list writes briefly so the backfill cannot race a
-- user-created board or list and leave duplicate defaults behind.
LOCK TABLE boards, buckets IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO boards (user_id, name, sort_order)
SELECT u.id, 'Today', 0
FROM users u
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
