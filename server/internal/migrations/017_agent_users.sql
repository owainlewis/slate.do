ALTER TABLE users
ADD COLUMN display_name text NOT NULL DEFAULT '';

UPDATE users
SET display_name = split_part(email, '@', 1)
WHERE display_name = '';

CREATE TABLE agent_users (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	display_name text NOT NULL CHECK (char_length(trim(display_name)) BETWEEN 1 AND 80),
	token_hash text NOT NULL UNIQUE,
	last_used_at timestamptz,
	revoked_at timestamptz,
	deleted_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX agent_users_owner_name_idx
ON agent_users (owner_user_id, lower(display_name));

ALTER TABLE tasks
ADD COLUMN assignee_agent_id uuid REFERENCES agent_users(id) ON DELETE SET NULL;

CREATE INDEX tasks_assignee_agent_status_idx
ON tasks (assignee_agent_id, status)
WHERE assignee_agent_id IS NOT NULL AND done = false;
