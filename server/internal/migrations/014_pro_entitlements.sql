CREATE TABLE entitlements (
	user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	plan text NOT NULL CHECK (plan = 'pro'),
	source text NOT NULL CHECK (source IN ('invite_code', 'stripe', 'manual', 'admin')),
	granted_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO entitlements (user_id, plan, source)
SELECT id, 'pro', 'admin'
FROM users
WHERE role = 'admin';

-- Existing working limits remain configurable, but Pro's hard maximum is 20.
UPDATE boards
SET max_tasks_per_list = 20, updated_at = now()
WHERE max_tasks_per_list > 20;
