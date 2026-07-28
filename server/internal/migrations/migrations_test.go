package migrations

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/owainlewis/slate.do/server/internal/database"
)

func TestOneAgentPerOwnerMigrationUpgradesExistingAgentSchema(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run migration integration tests")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		SET LOCAL search_path TO pg_temp;
		CREATE TEMP TABLE users (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			email text NOT NULL
		);
		CREATE TEMP TABLE tasks (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			status text NOT NULL DEFAULT 'queued',
			done boolean NOT NULL DEFAULT false
		);
		INSERT INTO users (email) VALUES ('owner@example.com');
	`); err != nil {
		t.Fatal(err)
	}
	migration17, err := files.ReadFile("017_agent_users.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(migration17)); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO agent_users (id, owner_user_id, display_name, token_hash, revoked_at, created_at)
		SELECT '10000000-0000-0000-0000-000000000001'::uuid, id, 'Oldest revoked', 'oldest', TIMESTAMPTZ '2026-07-27 09:30:00Z', TIMESTAMPTZ '2026-07-27 09:00:00Z' FROM users
		UNION ALL
		SELECT '10000000-0000-0000-0000-000000000002'::uuid, id, 'Usable replacement', 'replacement', NULL, TIMESTAMPTZ '2026-07-27 10:00:00Z' FROM users
		UNION ALL
		SELECT '10000000-0000-0000-0000-000000000003'::uuid, id, 'Newer duplicate', 'newest', NULL, TIMESTAMPTZ '2026-07-27 11:00:00Z' FROM users;
		INSERT INTO tasks (assignee_agent_id) VALUES ('10000000-0000-0000-0000-000000000003');
	`); err != nil {
		t.Fatal(err)
	}

	migration18, err := files.ReadFile("018_one_agent_per_owner.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(migration18)); err != nil {
		t.Fatal(err)
	}

	rows, err := tx.Query(ctx, `
		SELECT id::text, revoked_at IS NOT NULL, deleted_at IS NOT NULL
		FROM agent_users
		ORDER BY created_at
	`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	type agentState struct {
		id      string
		revoked bool
		deleted bool
	}
	var states []agentState
	for rows.Next() {
		var state agentState
		if err := rows.Scan(&state.id, &state.revoked, &state.deleted); err != nil {
			t.Fatal(err)
		}
		states = append(states, state)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(states) != 3 || !states[0].revoked || !states[0].deleted || states[1].revoked || states[1].deleted || !states[2].revoked || !states[2].deleted {
		t.Fatalf("migrated agent states = %#v", states)
	}
	if states[1].id != "10000000-0000-0000-0000-000000000002" {
		t.Fatalf("usable replacement was not preserved: %#v", states)
	}
	var usableTokenHash string
	if err := tx.QueryRow(ctx, "SELECT token_hash FROM agent_users WHERE deleted_at IS NULL").Scan(&usableTokenHash); err != nil {
		t.Fatal(err)
	}
	if usableTokenHash != "replacement" {
		t.Fatalf("usable token hash = %q", usableTokenHash)
	}

	var assignedAgent string
	if err := tx.QueryRow(ctx, "SELECT assignee_agent_id::text FROM tasks").Scan(&assignedAgent); err != nil {
		t.Fatal(err)
	}
	if assignedAgent != "10000000-0000-0000-0000-000000000003" {
		t.Fatalf("assignment changed to %q", assignedAgent)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO agent_users (owner_user_id, display_name, token_hash)
		SELECT id, 'Blocked', 'blocked' FROM users
	`); err == nil || !strings.Contains(err.Error(), "agent_users_one_active_per_owner_idx") {
		t.Fatalf("second live agent error = %v", err)
	}
}

func TestAgentIdentityMigrationPreservesAgentsCredentialsAndAssignments(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run migration integration tests")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		SET LOCAL search_path TO pg_temp;
		CREATE TEMP TABLE users (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			email text NOT NULL
		);
		CREATE TEMP TABLE tasks (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			status text NOT NULL DEFAULT 'queued',
			done boolean NOT NULL DEFAULT false
		);
		INSERT INTO users (email) VALUES ('owner@example.com');
	`); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"017_agent_users.sql"} {
		body, err := files.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			t.Fatalf("apply %s: %v", name, err)
		}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO agent_users (id, owner_user_id, display_name, token_hash, revoked_at, deleted_at, created_at, updated_at)
		SELECT '20000000-0000-0000-0000-000000000001'::uuid, id, 'Revoked Bot', 'revoked-hash',
			TIMESTAMPTZ '2026-07-27 09:30:00Z', NULL::timestamptz, TIMESTAMPTZ '2026-07-27 09:00:00Z', TIMESTAMPTZ '2026-07-27 09:30:00Z' FROM users
		UNION ALL
		SELECT '20000000-0000-0000-0000-000000000002'::uuid, id, 'Live Bot', 'live-hash',
			NULL::timestamptz, NULL::timestamptz, TIMESTAMPTZ '2026-07-27 10:00:00Z', TIMESTAMPTZ '2026-07-27 10:00:00Z' FROM users
		UNION ALL
		SELECT '20000000-0000-0000-0000-000000000003'::uuid, id, 'Extra Bot', 'extra-hash',
			NULL::timestamptz, NULL::timestamptz, TIMESTAMPTZ '2026-07-27 11:00:00Z', TIMESTAMPTZ '2026-07-27 11:00:00Z' FROM users
		UNION ALL
		SELECT '20000000-0000-0000-0000-000000000004'::uuid, id, 'Deleted Bot', 'deleted-hash',
			NULL::timestamptz, TIMESTAMPTZ '2026-07-27 12:30:00Z', TIMESTAMPTZ '2026-07-27 12:00:00Z', TIMESTAMPTZ '2026-07-27 12:30:00Z' FROM users;
		INSERT INTO tasks (assignee_agent_id) VALUES ('20000000-0000-0000-0000-000000000003');
		INSERT INTO users (email) VALUES ('revoked-owner@example.com');
		INSERT INTO agent_users (id, owner_user_id, display_name, token_hash, revoked_at, created_at, updated_at)
		SELECT '20000000-0000-0000-0000-000000000005'::uuid, id, 'Sole Revoked Bot', 'sole-revoked-hash',
			TIMESTAMPTZ '2026-07-27 13:30:00Z', TIMESTAMPTZ '2026-07-27 13:00:00Z', TIMESTAMPTZ '2026-07-27 13:30:00Z'
		FROM users
		WHERE email = 'revoked-owner@example.com';
	`); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"018_one_agent_per_owner.sql", "019_agent_identities_and_credentials.sql"} {
		body, err := files.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			t.Fatalf("apply %s: %v", name, err)
		}
	}

	rows, err := tx.Query(ctx, `
		SELECT a.id::text, a.archived_at IS NOT NULL, c.token_hash, c.revoked_at IS NOT NULL, c.token_prefix
		FROM agents a
		JOIN agent_credentials c ON c.agent_id = a.id
		ORDER BY a.created_at
	`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	type migratedAgent struct {
		id          string
		archived    bool
		tokenHash   string
		revoked     bool
		tokenPrefix *string
	}
	var agents []migratedAgent
	for rows.Next() {
		var agent migratedAgent
		if err := rows.Scan(&agent.id, &agent.archived, &agent.tokenHash, &agent.revoked, &agent.tokenPrefix); err != nil {
			t.Fatal(err)
		}
		agents = append(agents, agent)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(agents) != 5 {
		t.Fatalf("migrated agents = %#v", agents)
	}
	if !agents[0].archived || !agents[0].revoked || agents[0].tokenHash != "revoked-hash" ||
		agents[1].archived || agents[1].revoked || agents[1].tokenHash != "live-hash" ||
		!agents[2].archived || !agents[2].revoked || agents[2].tokenHash != "extra-hash" ||
		!agents[3].archived || !agents[3].revoked || agents[3].tokenHash != "deleted-hash" ||
		agents[4].archived || !agents[4].revoked || agents[4].tokenHash != "sole-revoked-hash" {
		t.Fatalf("migrated agent states = %#v", agents)
	}
	for _, agent := range agents {
		if agent.tokenPrefix != nil {
			t.Fatalf("migration invented token prefix for %s: %q", agent.id, *agent.tokenPrefix)
		}
	}

	var assignedAgent string
	if err := tx.QueryRow(ctx, "SELECT assignee_agent_id::text FROM tasks").Scan(&assignedAgent); err != nil {
		t.Fatal(err)
	}
	if assignedAgent != "20000000-0000-0000-0000-000000000003" {
		t.Fatalf("assignment changed to %q", assignedAgent)
	}
	var foreignKeyDefinition string
	if err := tx.QueryRow(ctx, `
		SELECT pg_get_constraintdef(oid)
		FROM pg_constraint
		WHERE conrelid = 'tasks'::regclass
			AND conname = 'tasks_assignee_agent_id_fkey'
	`).Scan(&foreignKeyDefinition); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(foreignKeyDefinition, "REFERENCES agents(id)") {
		t.Fatalf("assignment foreign key = %q", foreignKeyDefinition)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO agents (owner_user_id, name)
		SELECT id, '  live bot  ' FROM users
	`); err == nil || !strings.Contains(err.Error(), "agents_owner_active_name_idx") {
		t.Fatalf("case-insensitive active name error = %v", err)
	}
}

func TestAgentCredentialMigrationEnforcesOneActiveCredential(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run migration integration tests")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		SET LOCAL search_path TO pg_temp;
		CREATE TEMP TABLE users (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			email text NOT NULL
		);
		CREATE TEMP TABLE tasks (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			status text NOT NULL DEFAULT 'queued',
			done boolean NOT NULL DEFAULT false
		);
		INSERT INTO users (email) VALUES ('owner@example.com');
	`); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"017_agent_users.sql", "018_one_agent_per_owner.sql", "019_agent_identities_and_credentials.sql"} {
		body, err := files.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			t.Fatalf("apply %s: %v", name, err)
		}
	}
	var agentID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO agents (owner_user_id, name)
		SELECT id, 'Credential Bot' FROM users
		RETURNING id::text
	`).Scan(&agentID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO agent_credentials (agent_id, token_hash) VALUES ($1, 'first-active')", agentID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO agent_credentials (agent_id, token_hash) VALUES ($1, 'second-active')", agentID); err == nil || !strings.Contains(err.Error(), "agent_credentials_one_active_per_agent_idx") {
		t.Fatalf("second active credential error = %v", err)
	}
}

func TestProEntitlementMigrationKeepsExistingAdminsUsable(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run migration integration tests")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		SET LOCAL search_path TO pg_temp;
		CREATE TEMP TABLE users (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			role text NOT NULL
		);
		CREATE TEMP TABLE boards (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			max_tasks_per_list integer NOT NULL,
			updated_at timestamptz NOT NULL DEFAULT now()
		);
		INSERT INTO users (role) VALUES ('admin'), ('member');
		INSERT INTO boards (max_tasks_per_list) VALUES (50);
	`); err != nil {
		t.Fatal(err)
	}
	body, err := files.ReadFile("014_pro_entitlements.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}

	var plan, source string
	if err := tx.QueryRow(ctx, `
		SELECT e.plan, e.source
		FROM entitlements e
		JOIN users u ON u.id = e.user_id
		WHERE u.role = 'admin'
	`).Scan(&plan, &source); err != nil {
		t.Fatal(err)
	}
	if plan != "pro" || source != "admin" {
		t.Fatalf("admin entitlement = %q/%q, want pro/admin", plan, source)
	}
	var memberEntitlements, maxActiveItems int
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FROM entitlements e JOIN users u ON u.id = e.user_id WHERE u.role = 'member'
	`).Scan(&memberEntitlements); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, "SELECT max_tasks_per_list FROM boards").Scan(&maxActiveItems); err != nil {
		t.Fatal(err)
	}
	if memberEntitlements != 0 || maxActiveItems != 20 {
		t.Fatalf("member entitlements = %d, max active items = %d", memberEntitlements, maxActiveItems)
	}
}

func TestAdminMemberRolesMigration(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run migration integration tests")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		CREATE TEMP TABLE users (
			id integer PRIMARY KEY,
			role text NOT NULL DEFAULT 'owner',
			updated_at timestamptz NOT NULL DEFAULT now()
		);
		INSERT INTO users (id) VALUES (1);
	`); err != nil {
		t.Fatal(err)
	}
	body, err := files.ReadFile("012_admin_member_roles.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}

	var migratedRole string
	if err := tx.QueryRow(ctx, "SELECT role FROM users WHERE id = 1").Scan(&migratedRole); err != nil {
		t.Fatal(err)
	}
	if migratedRole != "admin" {
		t.Fatalf("migrated role = %q, want admin", migratedRole)
	}

	var defaultRole string
	if err := tx.QueryRow(ctx, "INSERT INTO users (id) VALUES (2) RETURNING role").Scan(&defaultRole); err != nil {
		t.Fatal(err)
	}
	if defaultRole != "member" {
		t.Fatalf("default role = %q, want member", defaultRole)
	}

	if _, err := tx.Exec(ctx, "INSERT INTO users (id, role) VALUES (3, 'owner')"); err == nil || !strings.Contains(err.Error(), "users_role_check") {
		t.Fatalf("invalid role error = %v, want users_role_check violation", err)
	}
}

func TestScheduledDateMigrationPreservesExistingValues(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run migration integration tests")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		CREATE TEMP TABLE tasks (
			id integer PRIMARY KEY,
			due_date date,
			notes text NOT NULL DEFAULT '',
			agent_brief text NOT NULL DEFAULT '',
			agent boolean NOT NULL DEFAULT false,
			legacy_assignee text NOT NULL DEFAULT '',
			status text NOT NULL DEFAULT 'queued',
			done boolean NOT NULL DEFAULT false
		);
		CREATE INDEX tasks_agent_status_idx ON tasks(status) WHERE agent = true AND done = false;
		INSERT INTO tasks (id, due_date) VALUES (1, DATE '2026-07-13'), (2, NULL);
	`)
	if err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{"005_task_description.sql", "007_task_scheduled_date.sql"} {
		body, err := files.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			t.Fatalf("apply %s: %v", name, err)
		}
	}

	rows, err := tx.Query(ctx, "SELECT COALESCE(scheduled_date::text, '') FROM tasks ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	var got []string
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			t.Fatal(err)
		}
		got = append(got, value)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != "2026-07-13" || got[1] != "" {
		t.Fatalf("scheduled dates = %#v", got)
	}
}

func TestNeutralItemsMigrationsPreserveExistingTasksAsActions(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run migration integration tests")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		CREATE TEMP TABLE buckets (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
		INSERT INTO buckets DEFAULT VALUES;
		CREATE TEMP TABLE tasks (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			bucket_id uuid NOT NULL REFERENCES buckets(id),
			title text NOT NULL,
			sort_order integer NOT NULL DEFAULT 0,
			created_at timestamptz NOT NULL DEFAULT now()
		);
		INSERT INTO tasks (bucket_id, title, sort_order, created_at)
		SELECT id, 'Cameras', 0, TIMESTAMPTZ '2026-07-11 09:00:00Z' FROM buckets
		UNION ALL
		SELECT id, 'Lenses', 1, TIMESTAMPTZ '2026-07-11 09:01:00Z' FROM buckets;
	`)
	if err != nil {
		t.Fatal(err)
	}
	body, err := files.ReadFile("008_neutral_items.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO tasks (bucket_id, title, parent_task_id, sort_order, created_at)
		SELECT bucket_id, 'Sony FX3', id, 2, TIMESTAMPTZ '2026-07-11 09:02:00Z'
		FROM tasks WHERE title = 'Cameras'
	`); err != nil {
		t.Fatal(err)
	}
	body, err = files.ReadFile("009_drop_sub_items.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}
	body, err = files.ReadFile("010_unify_task_kind.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}

	var existingKind string
	if err := tx.QueryRow(ctx, "SELECT kind FROM tasks WHERE title = 'Cameras'").Scan(&existingKind); err != nil {
		t.Fatal(err)
	}
	if existingKind != "action" {
		t.Fatalf("existing kind = %q, want action", existingKind)
	}
	rows, err := tx.Query(ctx, "SELECT title FROM tasks ORDER BY sort_order, created_at")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var titles []string
	for rows.Next() {
		var title string
		if err := rows.Scan(&title); err != nil {
			t.Fatal(err)
		}
		titles = append(titles, title)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(titles) != 3 || titles[0] != "Cameras" || titles[1] != "Sony FX3" || titles[2] != "Lenses" {
		t.Fatalf("flattened order = %#v", titles)
	}
	var newKind string
	if err := tx.QueryRow(ctx, "INSERT INTO tasks (bucket_id, title) SELECT id, 'New item' FROM buckets LIMIT 1 RETURNING kind").Scan(&newKind); err != nil {
		t.Fatal(err)
	}
	if newKind != "action" {
		t.Fatalf("new kind = %q, want action", newKind)
	}
	var goal string
	if err := tx.QueryRow(ctx, "INSERT INTO buckets DEFAULT VALUES RETURNING goal").Scan(&goal); err != nil {
		t.Fatal(err)
	}
	if goal != "" {
		t.Fatalf("default goal = %q", goal)
	}
	var hasParentColumn bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_attribute
			WHERE attrelid = 'pg_temp.tasks'::regclass
				AND attname = 'parent_task_id'
				AND NOT attisdropped
		)
	`).Scan(&hasParentColumn); err != nil {
		t.Fatal(err)
	}
	if hasParentColumn {
		t.Fatal("parent_task_id should be removed")
	}
}
