WITH ranked_agents AS (
	SELECT
		id,
		row_number() OVER (
			PARTITION BY owner_user_id
			ORDER BY created_at, id
		) AS owner_position
	FROM agent_users
	WHERE deleted_at IS NULL
)
UPDATE agent_users agent
SET revoked_at = COALESCE(agent.revoked_at, now()),
	deleted_at = now(),
	updated_at = now()
FROM ranked_agents ranked
WHERE agent.id = ranked.id
	AND ranked.owner_position > 1;

DROP INDEX agent_users_owner_name_idx;

CREATE UNIQUE INDEX agent_users_one_active_per_owner_idx
ON agent_users (owner_user_id)
WHERE deleted_at IS NULL;
