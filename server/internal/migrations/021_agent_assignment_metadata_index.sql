CREATE INDEX tasks_assignee_board_bucket_idx
ON tasks (assignee_agent_id, board_id, bucket_id)
WHERE assignee_agent_id IS NOT NULL;
