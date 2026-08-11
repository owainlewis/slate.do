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
    ORDER BY b.user_id, b.sort_order, b.created_at, l.sort_order, l.created_at
)
UPDATE buckets
SET is_inbox = true,
    updated_at = now()
WHERE id IN (SELECT id FROM first_list);
