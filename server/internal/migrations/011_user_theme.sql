ALTER TABLE users
ADD COLUMN theme text NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark'));

UPDATE users
SET theme = COALESCE((
	SELECT CASE
		WHEN boards.background_value IN ('dark', 'charcoal') THEN 'dark'
		ELSE 'light'
	END
	FROM boards
	WHERE boards.user_id = users.id
	ORDER BY boards.sort_order, boards.created_at
	LIMIT 1
), 'light');
