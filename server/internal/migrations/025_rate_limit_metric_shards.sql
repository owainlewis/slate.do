ALTER TABLE api_rate_limit_metrics
DROP CONSTRAINT api_rate_limit_metrics_pkey,
ADD COLUMN shard smallint NOT NULL DEFAULT 0 CHECK (shard BETWEEN 0 AND 31);

ALTER TABLE api_rate_limit_metrics ALTER COLUMN shard DROP DEFAULT;

ALTER TABLE api_rate_limit_metrics
ADD PRIMARY KEY (bucket_start, route_class, outcome, shard);
