ALTER TABLE users
ADD COLUMN disabled_at timestamptz;

CREATE TABLE signup_rate_limits (
	dimension text NOT NULL CHECK (dimension IN ('ip', 'email')),
	key_hash text NOT NULL,
	window_started_at timestamptz NOT NULL,
	attempts integer NOT NULL CHECK (attempts > 0),
	PRIMARY KEY (dimension, key_hash)
);

CREATE INDEX signup_rate_limits_window_idx
ON signup_rate_limits (window_started_at);
