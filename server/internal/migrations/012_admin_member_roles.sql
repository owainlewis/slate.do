UPDATE users
SET role = 'admin', updated_at = now()
WHERE role = 'owner';

ALTER TABLE users
ALTER COLUMN role SET DEFAULT 'member';

ALTER TABLE users
ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'member'));
