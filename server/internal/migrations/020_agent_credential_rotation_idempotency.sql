CREATE TABLE agent_credential_rotations (
	owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	idempotency_key text NOT NULL,
	agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
	credential_id uuid NOT NULL REFERENCES agent_credentials(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (owner_user_id, idempotency_key),
	CONSTRAINT agent_credential_rotations_key_length_check
		CHECK (char_length(idempotency_key) BETWEEN 16 AND 128)
);

CREATE UNIQUE INDEX agent_credential_rotations_credential_idx
ON agent_credential_rotations (credential_id);
