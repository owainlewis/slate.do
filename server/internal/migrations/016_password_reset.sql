CREATE TABLE password_reset_tokens (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	token_hash text NOT NULL UNIQUE,
	expires_at timestamptz NOT NULL,
	used_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_idx
ON password_reset_tokens (user_id, created_at DESC);

CREATE INDEX password_reset_tokens_expiry_idx
ON password_reset_tokens (expires_at)
WHERE used_at IS NULL;

CREATE TABLE password_reset_requests (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	email text NOT NULL,
	available_at timestamptz NOT NULL DEFAULT now(),
	claimed_at timestamptz,
	attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
	processed_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_requests_pending_idx
ON password_reset_requests (available_at, created_at)
WHERE processed_at IS NULL;

CREATE TABLE password_reset_rate_limits (
	dimension text NOT NULL CHECK (dimension IN ('ip', 'email')),
	key_hash text NOT NULL,
	window_started_at timestamptz NOT NULL,
	attempts integer NOT NULL CHECK (attempts > 0),
	PRIMARY KEY (dimension, key_hash)
);

CREATE INDEX password_reset_rate_limits_window_idx
ON password_reset_rate_limits (window_started_at);

CREATE TABLE password_reset_confirmation_rate_limits (
	dimension text NOT NULL CHECK (dimension IN ('ip', 'token')),
	key_hash text NOT NULL,
	window_started_at timestamptz NOT NULL,
	attempts integer NOT NULL CHECK (attempts > 0),
	PRIMARY KEY (dimension, key_hash)
);

CREATE INDEX password_reset_confirmation_rate_limits_window_idx
ON password_reset_confirmation_rate_limits (window_started_at);
