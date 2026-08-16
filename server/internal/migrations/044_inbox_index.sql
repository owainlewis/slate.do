-- The inbox reads agent-authored entries across every task in an account,
-- newest first. Without this the query scans and sorts the whole table.
CREATE INDEX card_entries_agent_created_idx
ON card_entries (created_at DESC, id DESC)
WHERE author_kind = 'agent';
