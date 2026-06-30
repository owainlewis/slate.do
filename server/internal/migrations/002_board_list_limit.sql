ALTER TABLE boards
ADD COLUMN max_tasks_per_list integer NOT NULL DEFAULT 10 CHECK (max_tasks_per_list > 0);
