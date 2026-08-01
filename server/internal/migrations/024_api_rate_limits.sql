CREATE TABLE api_rate_limit_settings (
	singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
	authenticated_read_limit integer NOT NULL CHECK (authenticated_read_limit > 0),
	authenticated_write_limit integer NOT NULL CHECK (authenticated_write_limit > 0),
	public_auth_limit integer NOT NULL CHECK (public_auth_limit > 0),
	updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO api_rate_limit_settings (
	singleton,
	authenticated_read_limit,
	authenticated_write_limit,
	public_auth_limit
) VALUES (true, 120, 60, 20);

CREATE TABLE api_rate_limit_state (
	scope text NOT NULL CHECK (scope IN ('account', 'credential', 'ip')),
	key_hash text NOT NULL,
	route_class text NOT NULL CHECK (route_class IN ('authenticated_read', 'authenticated_write', 'public_auth')),
	request_times timestamptz[] NOT NULL DEFAULT '{}',
	expires_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (scope, key_hash, route_class)
);

CREATE INDEX api_rate_limit_state_expiry_idx ON api_rate_limit_state(expires_at);

CREATE TABLE api_rate_limit_metrics (
	bucket_start timestamptz NOT NULL,
	route_class text NOT NULL CHECK (route_class IN ('authenticated_read', 'authenticated_write', 'public_auth')),
	outcome text NOT NULL CHECK (outcome IN ('allowed', 'rejected')),
	request_count bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),
	PRIMARY KEY (bucket_start, route_class, outcome)
);
