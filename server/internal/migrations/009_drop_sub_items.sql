WITH flattened AS (
    SELECT
        task.id,
        row_number() OVER (
            PARTITION BY task.bucket_id
            ORDER BY
                COALESCE(parent.sort_order, task.sort_order),
                COALESCE(parent.created_at, task.created_at),
                CASE WHEN task.parent_task_id IS NULL THEN 0 ELSE 1 END,
                task.sort_order,
                task.created_at
        ) - 1 AS sort_order
    FROM tasks task
    LEFT JOIN tasks parent ON parent.id = task.parent_task_id
)
UPDATE tasks task
SET sort_order = flattened.sort_order
FROM flattened
WHERE flattened.id = task.id;

ALTER TABLE tasks
DROP COLUMN parent_task_id;
