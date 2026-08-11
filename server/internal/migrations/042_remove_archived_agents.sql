-- Archiving is no longer part of the agent lifecycle. Remove legacy archived
-- identities before the UI and API switch to direct deletion. Existing foreign
-- keys unassign cards and cascade credentials, while card entries retain their
-- stored author name.
DELETE FROM agents
WHERE archived_at IS NOT NULL;

-- Migrations run before the new revision receives traffic. Keep an old revision
-- from recreating an archived identity during that deployment window.
ALTER TABLE agents
ADD CONSTRAINT agents_archiving_disabled_check
CHECK (archived_at IS NULL);
