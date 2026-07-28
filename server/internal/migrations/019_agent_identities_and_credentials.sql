ALTER TABLE agent_users RENAME TO agents;

DROP INDEX agent_users_one_active_per_owner_idx;

ALTER TABLE agents RENAME CONSTRAINT agent_users_pkey TO agents_pkey;
ALTER TABLE agents RENAME CONSTRAINT agent_users_owner_user_id_fkey TO agents_owner_user_id_fkey;
ALTER TABLE agents RENAME CONSTRAINT agent_users_display_name_check TO agents_name_check;

ALTER TABLE agents RENAME COLUMN display_name TO name;
ALTER TABLE agents RENAME COLUMN deleted_at TO archived_at;

ALTER TABLE agents
ADD COLUMN purpose text,
ADD CONSTRAINT agents_purpose_length_check
	CHECK (purpose IS NULL OR char_length(trim(purpose)) BETWEEN 1 AND 500);

CREATE TABLE agent_credentials (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
	token_hash text NOT NULL UNIQUE,
	token_prefix text,
	last_used_at timestamptz,
	revoked_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT agent_credentials_token_prefix_check
		CHECK (token_prefix IS NULL OR char_length(token_prefix) BETWEEN 1 AND 32)
);

INSERT INTO agent_credentials (
	agent_id,
	token_hash,
	last_used_at,
	revoked_at,
	created_at,
	updated_at
)
SELECT
	id,
	token_hash,
	last_used_at,
	CASE
		WHEN archived_at IS NOT NULL THEN COALESCE(revoked_at, archived_at)
		ELSE revoked_at
	END,
	created_at,
	updated_at
FROM agents;

ALTER TABLE agents
DROP COLUMN token_hash,
DROP COLUMN last_used_at,
DROP COLUMN revoked_at;

CREATE UNIQUE INDEX agents_owner_active_name_idx
ON agents (owner_user_id, lower(trim(name)))
WHERE archived_at IS NULL;

CREATE UNIQUE INDEX agent_credentials_one_active_per_agent_idx
ON agent_credentials (agent_id)
WHERE revoked_at IS NULL;
