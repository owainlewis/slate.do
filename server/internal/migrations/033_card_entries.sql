CREATE TABLE card_entries (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
	kind text NOT NULL CHECK (kind IN ('comment', 'output')),
	body text NOT NULL CHECK (char_length(trim(body)) > 0),
	needs_response boolean NOT NULL DEFAULT false,
	author_kind text NOT NULL CHECK (author_kind IN ('human', 'agent')),
	author_id uuid NOT NULL,
	author_name text NOT NULL CHECK (char_length(trim(author_name)) > 0),
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX card_entries_task_created_idx
ON card_entries (task_id, created_at, id);
