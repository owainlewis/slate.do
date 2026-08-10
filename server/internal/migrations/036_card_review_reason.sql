ALTER TABLE tasks
ADD COLUMN review_reason text NOT NULL DEFAULT ''
CHECK (review_reason IN ('', 'output'));

UPDATE tasks task
SET review_reason = 'output'
FROM card_entries entry
WHERE task.status = 'needs_review'
  AND entry.task_id = task.id
  AND entry.kind = 'output'
  AND entry.created_at = task.updated_at;
