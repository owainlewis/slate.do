ALTER TABLE card_entries
ADD COLUMN idempotency_key text,
ADD COLUMN request_hash text;

CREATE UNIQUE INDEX card_entries_idempotency_idx
ON card_entries (task_id, author_kind, author_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
