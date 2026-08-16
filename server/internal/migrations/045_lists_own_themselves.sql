-- Step one of collapsing boards into lists: give a list an owner of its own.
--
-- A list currently belongs to a board, and a board belongs to a user, so
-- ownership is one hop away from every query. This backfills the owner onto the
-- list itself. Nothing reads the column yet.
--
-- A trigger keeps it correct rather than every insert site remembering to set
-- it. That matters during the transition: board_id is still the source of
-- truth, and a writer that predates this column must not be able to create a
-- list with no owner. The trigger goes when board_id does.
--
-- Deliberately no "one Inbox per account" constraint. Creating a board creates
-- an Inbox inside it, so any account with two boards already has two inbox
-- lists and such a constraint would fail on live data. Consolidating them is a
-- data decision that belongs with the step that removes boards.
ALTER TABLE buckets ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE CASCADE;

-- Always derive, never trust what was supplied. board_id is the source of
-- truth until it goes, so an insert naming the wrong owner, a list moved to
-- another owner's board, or a direct write to user_id must all end up with the
-- board's owner rather than leaving a list owned by the wrong account.
CREATE FUNCTION buckets_inherit_board_owner() RETURNS trigger AS $$
BEGIN
	SELECT boards.user_id INTO NEW.user_id FROM boards WHERE boards.id = NEW.board_id;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER buckets_inherit_board_owner_trigger
BEFORE INSERT OR UPDATE OF board_id, user_id ON buckets
FOR EACH ROW EXECUTE FUNCTION buckets_inherit_board_owner();

UPDATE buckets SET user_id = boards.user_id
FROM boards
WHERE boards.id = buckets.board_id;

ALTER TABLE buckets ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX buckets_user_sort_idx ON buckets (user_id, sort_order, id);
