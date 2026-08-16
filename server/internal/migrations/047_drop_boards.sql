-- Step three of collapsing boards into lists: the board itself goes.
--
-- Nothing has read these columns since 046. This step waits for its own
-- deploy so that the revision running when it applies is one that never
-- mentions a board, which is what makes dropping safe rather than a race.
--
-- The foreign keys and the three indexes that lead with board_id go with the
-- columns they belong to. Their replacements landed in 046: lists sort by
-- owner, and tasks index their own owner for the account-wide reads.

ALTER TABLE tasks DROP COLUMN board_id;
ALTER TABLE buckets DROP COLUMN board_id;

DROP TABLE boards;
