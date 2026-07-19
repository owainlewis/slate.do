CREATE TABLE task_idempotency_keys (
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	key text NOT NULL,
	request_hash text NOT NULL,
	task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, key)
);

CREATE INDEX task_idempotency_keys_task_idx
ON task_idempotency_keys (task_id);
