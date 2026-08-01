ALTER TABLE agents
DROP CONSTRAINT agents_name_check,
ADD CONSTRAINT agents_name_check
	CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
DROP CONSTRAINT agents_purpose_length_check,
ADD CONSTRAINT agents_purpose_length_check
	CHECK (purpose IS NULL OR octet_length(trim(purpose)) BETWEEN 1 AND 4096);
