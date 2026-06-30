CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	email text NOT NULL UNIQUE,
	password_hash text NOT NULL,
	role text NOT NULL DEFAULT 'owner',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token_hash text NOT NULL UNIQUE,
	expires_at timestamptz NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_tokens (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name text NOT NULL,
	token_hash text NOT NULL UNIQUE,
	last_used_at timestamptz,
	revoked_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE boards (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name text NOT NULL,
	background_kind text NOT NULL DEFAULT 'plain',
	background_value text NOT NULL DEFAULT '',
	layout_size integer NOT NULL DEFAULT 6 CHECK (layout_size IN (3, 6)),
	sort_order integer NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE buckets (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	name text NOT NULL,
	is_inbox boolean NOT NULL DEFAULT false,
	limit_count integer NOT NULL DEFAULT 5 CHECK (limit_count > 0),
	sort_order integer NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
	bucket_id uuid NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
	title text NOT NULL,
	done boolean NOT NULL DEFAULT false,
	focus boolean NOT NULL DEFAULT false,
	assignee text NOT NULL DEFAULT '',
	status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'working', 'needs_review', 'done')),
	due_date date,
	notes text NOT NULL DEFAULT '',
	agent_brief text NOT NULL DEFAULT '',
	sort_order integer NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX boards_user_order_idx ON boards(user_id, sort_order, created_at);
CREATE INDEX buckets_board_order_idx ON buckets(board_id, sort_order, created_at);
CREATE INDEX tasks_bucket_order_idx ON tasks(bucket_id, sort_order, created_at);
CREATE INDEX tasks_assignee_status_idx ON tasks(assignee, status) WHERE done = false;
