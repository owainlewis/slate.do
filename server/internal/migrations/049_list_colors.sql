ALTER TABLE buckets
ADD COLUMN color text NOT NULL DEFAULT 'slate'
CHECK (color IN ('slate', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink'));

COMMENT ON COLUMN buckets.color IS 'Named list color from the supported application palette.';
