package migrations

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/boards"
	"github.com/owainlewis/slate.do/server/internal/database"
)

func TestEnsureAccountInboxMigrationSkipsAnInFlightBoardCreation(t *testing.T) {
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
	if _, err := Apply(ctx, db); err != nil {
		t.Fatal(err)
	}

	email := fmt.Sprintf("inbox-migration-race-%d@example.invalid", time.Now().UnixNano())
	var userID string
	if err := db.QueryRow(ctx, "INSERT INTO users (email, password_hash) VALUES ($1, 'test') RETURNING id::text", email).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	createTx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer createTx.Rollback(ctx)
	if _, err := createTx.Exec(ctx, "SELECT id FROM users WHERE id = $1 FOR UPDATE", userID); err != nil {
		t.Fatal(err)
	}
	var boardCount int
	if err := createTx.QueryRow(ctx, "SELECT count(*) FROM boards WHERE user_id = $1", userID).Scan(&boardCount); err != nil {
		t.Fatal(err)
	}
	if boardCount != 0 {
		t.Fatalf("boards before create = %d, want 0", boardCount)
	}

	migrationConn, err := db.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer migrationConn.Release()
	body, err := files.ReadFile("032_repair_account_inbox.sql")
	if err != nil {
		t.Fatal(err)
	}
	migrationResult := make(chan error, 1)
	go func() {
		_, err := migrationConn.Exec(context.Background(), string(body))
		migrationResult <- err
	}()

	select {
	case err := <-migrationResult:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("migration waited for an account with an in-flight board creation")
	}

	if _, err := createTx.Exec(ctx, `
		INSERT INTO boards (user_id, name, max_tasks_per_list, sort_order)
		VALUES ($1, 'User board', 25, 0)
	`, userID); err != nil {
		t.Fatal(err)
	}
	if err := createTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := boards.NewStore(db).EnsureInboxBucketID(ctx, userID); err != nil {
		t.Fatal(err)
	}

	var boards, lists, inboxes int
	if err := db.QueryRow(ctx, `
		SELECT count(DISTINCT b.id)::int, count(l.id)::int,
			count(l.id) FILTER (WHERE l.is_inbox)::int
		FROM boards b
		LEFT JOIN buckets l ON l.board_id = b.id
		WHERE b.user_id = $1
	`, userID).Scan(&boards, &lists, &inboxes); err != nil {
		t.Fatal(err)
	}
	if boards != 1 || lists != 1 || inboxes != 1 {
		t.Fatalf("boards = %d, lists = %d, inboxes = %d", boards, lists, inboxes)
	}
}

func TestEnsureAccountInboxMigrationRepairsEveryExistingAccountState(t *testing.T) {
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
	if _, err := Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	marker := fmt.Sprintf("inbox-migration-%d", time.Now().UnixNano())
	emails := map[string]string{
		"noBoard":       marker + "-no-board@example.invalid",
		"noList":        marker + "-no-list@example.invalid",
		"existingList":  marker + "-existing-list@example.invalid",
		"existingInbox": marker + "-existing-inbox@example.invalid",
	}
	for _, email := range emails {
		if _, err := tx.Exec(ctx, "INSERT INTO users (email, password_hash) VALUES ($1, 'test')", email); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO boards (user_id, name, sort_order)
		SELECT id, 'Empty board', 0 FROM users WHERE email = $1
		UNION ALL
		SELECT id, 'List board', 0 FROM users WHERE email = $2
		UNION ALL
		SELECT id, 'Inbox board', 0 FROM users WHERE email = $3
	`, emails["noList"], emails["existingList"], emails["existingInbox"]); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO buckets (board_id, name, is_inbox, sort_order)
		SELECT b.id, 'First list', false, 0 FROM boards b JOIN users u ON u.id = b.user_id WHERE u.email = $1
		UNION ALL
		SELECT b.id, 'Second list', false, 1 FROM boards b JOIN users u ON u.id = b.user_id WHERE u.email = $1
		UNION ALL
		SELECT b.id, 'Existing Inbox', true, 0 FROM boards b JOIN users u ON u.id = b.user_id WHERE u.email = $2
		UNION ALL
		SELECT b.id, 'Other list', false, 1 FROM boards b JOIN users u ON u.id = b.user_id WHERE u.email = $2
	`, emails["existingList"], emails["existingInbox"]); err != nil {
		t.Fatal(err)
	}

	body, err := files.ReadFile("032_repair_account_inbox.sql")
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			t.Fatalf("apply attempt %d: %v", attempt+1, err)
		}
	}

	tests := []struct {
		name      string
		email     string
		boards    int
		lists     int
		inboxes   int
		inboxName string
	}{
		{"no board", emails["noBoard"], 1, 1, 1, "Inbox"},
		{"board without lists", emails["noList"], 1, 1, 1, "Inbox"},
		{"existing lists", emails["existingList"], 1, 2, 1, "First list"},
		{"existing Inbox", emails["existingInbox"], 1, 2, 1, "Existing Inbox"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var boards, lists, inboxes int
			var inboxName string
			err := tx.QueryRow(ctx, `
				SELECT
					count(DISTINCT b.id)::int,
					count(l.id)::int,
					count(l.id) FILTER (WHERE l.is_inbox)::int,
					COALESCE(min(l.name) FILTER (WHERE l.is_inbox), '')
				FROM users u
				LEFT JOIN boards b ON b.user_id = u.id
				LEFT JOIN buckets l ON l.board_id = b.id
				WHERE u.email = $1
				GROUP BY u.id
			`, test.email).Scan(&boards, &lists, &inboxes, &inboxName)
			if err != nil {
				t.Fatal(err)
			}
			if boards != test.boards || lists != test.lists || inboxes != test.inboxes || inboxName != test.inboxName {
				t.Fatalf("boards = %d, lists = %d, inboxes = %d, Inbox = %q", boards, lists, inboxes, inboxName)
			}
		})
	}
}

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

func TestAgentCredentialRotationMigrationStoresOnlyReferences(t *testing.T) {
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
		CREATE TEMP TABLE users (id uuid PRIMARY KEY);
		CREATE TEMP TABLE agents (id uuid PRIMARY KEY);
		CREATE TEMP TABLE agent_credentials (id uuid PRIMARY KEY);
		INSERT INTO users VALUES ('10000000-0000-0000-0000-000000000001');
		INSERT INTO agents VALUES ('20000000-0000-0000-0000-000000000001'), ('20000000-0000-0000-0000-000000000002');
		INSERT INTO agent_credentials VALUES ('30000000-0000-0000-0000-000000000001'), ('30000000-0000-0000-0000-000000000002');
	`); err != nil {
		t.Fatal(err)
	}
	body, err := files.ReadFile("020_agent_credential_rotation_idempotency.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "SAVEPOINT duplicate_rotation"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO agent_credential_rotations (owner_user_id, idempotency_key, agent_id, credential_id)
		VALUES (
			'10000000-0000-0000-0000-000000000001',
			'rotation-key-00000001',
			'20000000-0000-0000-0000-000000000001',
			'30000000-0000-0000-0000-000000000001'
		)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO agent_credential_rotations (owner_user_id, idempotency_key, agent_id, credential_id)
		VALUES (
			'10000000-0000-0000-0000-000000000001',
			'rotation-key-00000001',
			'20000000-0000-0000-0000-000000000002',
			'30000000-0000-0000-0000-000000000002'
		)
	`); err == nil || !strings.Contains(err.Error(), "agent_credential_rotations_pkey") {
		t.Fatalf("duplicate owner key error = %v", err)
	}
	if _, err := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT duplicate_rotation"); err != nil {
		t.Fatal(err)
	}
	rows, err := tx.Query(ctx, `
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema LIKE 'pg_temp_%' AND table_name = 'agent_credential_rotations'
	`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var columns []string
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			t.Fatal(err)
		}
		columns = append(columns, column)
	}
	for _, column := range columns {
		if strings.Contains(column, "token") || strings.Contains(column, "plain") || strings.Contains(column, "secret") {
			t.Fatalf("rotation idempotency stores secret-like column %q", column)
		}
	}
}

func TestAgentAssignmentMetadataIndexCoversCompletedTasks(t *testing.T) {
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
		CREATE TEMP TABLE tasks (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			assignee_agent_id uuid,
			board_id uuid NOT NULL,
			bucket_id uuid NOT NULL,
			done boolean NOT NULL DEFAULT false
		);
		INSERT INTO tasks (assignee_agent_id, board_id, bucket_id, done)
		VALUES (
			'10000000-0000-0000-0000-000000000001',
			'20000000-0000-0000-0000-000000000001',
			'30000000-0000-0000-0000-000000000001',
			true
		);
	`); err != nil {
		t.Fatal(err)
	}
	body, err := files.ReadFile("021_agent_assignment_metadata_index.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}

	var definition, predicate string
	if err := tx.QueryRow(ctx, `
		SELECT pg_get_indexdef(i.indexrelid), COALESCE(pg_get_expr(i.indpred, i.indrelid), '')
		FROM pg_index i
		JOIN pg_class idx ON idx.oid = i.indexrelid
		WHERE idx.relname = 'tasks_assignee_board_bucket_idx'
			AND i.indrelid = 'tasks'::regclass
	`).Scan(&definition, &predicate); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(definition, "(assignee_agent_id, board_id, bucket_id)") {
		t.Fatalf("assignment metadata index = %q", definition)
	}
	if !strings.Contains(predicate, "assignee_agent_id IS NOT NULL") || strings.Contains(predicate, "done") {
		t.Fatalf("assignment metadata predicate = %q", predicate)
	}

	if _, err := tx.Exec(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
		t.Fatal(err)
	}
	rows, err := tx.Query(ctx, `
		EXPLAIN (COSTS OFF)
		SELECT 1
		FROM tasks
		WHERE assignee_agent_id = '10000000-0000-0000-0000-000000000001'
			AND board_id = '20000000-0000-0000-0000-000000000001'
	`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(line)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.String(), "tasks_assignee_board_bucket_idx") {
		t.Fatalf("assignment metadata query plan did not use index:\n%s", plan.String())
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

func TestAccountStorageUsageMigrationBackfillsUTF8Bytes(t *testing.T) {
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
		CREATE SCHEMA quota_migration_test;
		SET LOCAL search_path TO quota_migration_test, public;
		CREATE TABLE users (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			role text NOT NULL DEFAULT 'member'
		);
		CREATE TABLE entitlements (
			user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			plan text NOT NULL
		);
		CREATE TABLE boards (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
		);
		CREATE TABLE tasks (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
			title text NOT NULL,
			description text NOT NULL DEFAULT ''
		);
		WITH created_user AS (
			INSERT INTO users DEFAULT VALUES RETURNING id
		), created_board AS (
			INSERT INTO boards (user_id) SELECT id FROM created_user RETURNING id
		)
		INSERT INTO tasks (board_id, title, description)
		SELECT id, 'é', '🙂' FROM created_board
		UNION ALL
		SELECT id, 'abc', '' FROM created_board;
	`); err != nil {
		t.Fatal(err)
	}
	body, err := files.ReadFile("026_account_storage_usage.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}

	var tasks, contentBytes, generatedBytes int64
	if err := tx.QueryRow(ctx, `
		SELECT stored_tasks, stored_content_bytes FROM account_storage_usage
	`).Scan(&tasks, &contentBytes); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, "SELECT sum(storage_bytes) FROM tasks").Scan(&generatedBytes); err != nil {
		t.Fatal(err)
	}
	if tasks != 2 || contentBytes != 9 || generatedBytes != 9 {
		t.Fatalf("backfill = tasks=%d content=%d generated=%d", tasks, contentBytes, generatedBytes)
	}

	var directTaskID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO tasks (board_id, title, description)
		SELECT id, 'z', '' FROM boards LIMIT 1
		RETURNING id::text
	`).Scan(&directTaskID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "UPDATE tasks SET title = 'é' WHERE id = $1", directTaskID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM tasks WHERE id = $1", directTaskID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, "SELECT stored_tasks, stored_content_bytes FROM account_storage_usage").Scan(&tasks, &contentBytes); err != nil {
		t.Fatal(err)
	}
	if tasks != 2 || contentBytes != 9 {
		t.Fatalf("trigger lifecycle usage = tasks=%d content=%d", tasks, contentBytes)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO tasks (board_id, title, description)
		SELECT b.id, 'x', ''
		FROM boards b CROSS JOIN generate_series(1, 498)
	`); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, "SELECT stored_tasks, stored_content_bytes FROM account_storage_usage").Scan(&tasks, &contentBytes); err != nil {
		t.Fatal(err)
	}
	if tasks != 500 || contentBytes != 507 {
		t.Fatalf("trigger exact limit = tasks=%d content=%d", tasks, contentBytes)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO tasks (board_id, title, description)
		SELECT id, 'over', '' FROM boards LIMIT 1
	`); err == nil || !strings.Contains(err.Error(), "stored_task_limit_reached") {
		t.Fatalf("trigger over-limit error = %v", err)
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

func TestNewCardStatusMigrationAddsCaptureStateAndDefault(t *testing.T) {
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
		CREATE TEMP TABLE tasks (
			status text NOT NULL DEFAULT 'queued',
			CONSTRAINT tasks_status_check CHECK (status IN ('queued', 'working', 'needs_review', 'done'))
		)
	`); err != nil {
		t.Fatal(err)
	}
	body, err := files.ReadFile("037_new_card_status.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}

	var status string
	if err := tx.QueryRow(ctx, "INSERT INTO tasks DEFAULT VALUES RETURNING status").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "new" {
		t.Fatalf("default status = %q, want new", status)
	}
	for _, value := range []string{"new", "queued", "working", "needs_review", "done"} {
		if _, err := tx.Exec(ctx, "INSERT INTO tasks (status) VALUES ($1)", value); err != nil {
			t.Fatalf("insert status %q: %v", value, err)
		}
	}
}

func TestStatusOnlyCardsMigrationPreservesCompletionAndDropsLegacyColumn(t *testing.T) {
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
		CREATE TEMP TABLE tasks (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			board_id uuid NOT NULL DEFAULT gen_random_uuid(),
			bucket_id uuid NOT NULL DEFAULT gen_random_uuid(),
			assignee_agent_id uuid,
			priority text NOT NULL DEFAULT '',
			status text NOT NULL DEFAULT 'new',
			done boolean NOT NULL DEFAULT false,
			updated_at timestamptz NOT NULL DEFAULT now()
		);
		CREATE INDEX tasks_assignee_agent_status_idx ON tasks (assignee_agent_id, status) WHERE assignee_agent_id IS NOT NULL AND done = false;
		CREATE INDEX tasks_board_priority_idx ON tasks (board_id, priority) WHERE priority <> '' AND done = false;
		CREATE INDEX tasks_bucket_completed_history_idx ON tasks (bucket_id, updated_at DESC, id DESC) WHERE done = true;
		CREATE INDEX tasks_status_idx ON tasks(status) WHERE done = false;
		INSERT INTO tasks (status, done) VALUES ('queued', true), ('working', false), ('done', false);
	`); err != nil {
		t.Fatal(err)
	}
	body, err := files.ReadFile("038_status_only_cards.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}

	rows, err := tx.Query(ctx, "SELECT status FROM tasks ORDER BY status")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var statuses []string
	for rows.Next() {
		var status string
		if err := rows.Scan(&status); err != nil {
			t.Fatal(err)
		}
		statuses = append(statuses, status)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if strings.Join(statuses, ",") != "done,done,working" {
		t.Fatalf("statuses = %#v", statuses)
	}

	var hasDoneColumn bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_attribute
			WHERE attrelid = 'pg_temp.tasks'::regclass AND attname = 'done' AND NOT attisdropped
		)
	`).Scan(&hasDoneColumn); err != nil {
		t.Fatal(err)
	}
	if hasDoneColumn {
		t.Fatal("legacy done column still exists")
	}

	var predicates string
	if err := tx.QueryRow(ctx, `
		SELECT string_agg(pg_get_expr(indexprs.indpred, indexprs.indrelid), ' ')
		FROM pg_index indexprs
		WHERE indexprs.indrelid = 'pg_temp.tasks'::regclass AND indexprs.indpred IS NOT NULL
	`).Scan(&predicates); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(predicates, "done = true") || strings.Contains(predicates, "done = false") {
		t.Fatalf("legacy index predicate remains: %s", predicates)
	}
}

func TestTaskIdempotencyRequestDataMigrationBackfillsImmutableSnapshot(t *testing.T) {
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
		CREATE TEMP TABLE tasks (
			id uuid PRIMARY KEY,
			title text NOT NULL,
			description text NOT NULL DEFAULT '',
			scheduled_date date,
			kind text NOT NULL,
			assignee_agent_id uuid,
			parent_task_id uuid
		);
		CREATE TEMP TABLE task_idempotency_keys (
			user_id uuid NOT NULL,
			key text NOT NULL,
			request_hash text NOT NULL,
			task_id uuid
		);
		INSERT INTO tasks (id, title, description, scheduled_date, kind, parent_task_id)
		VALUES (
			'11111111-1111-4111-8111-111111111111',
			'Original child', 'Original context', '2026-08-12', 'action',
			'22222222-2222-4222-8222-222222222222'
		);
		INSERT INTO task_idempotency_keys (user_id, key, request_hash, task_id)
		VALUES (
			'33333333-3333-4333-8333-333333333333', 'legacy-child', 'legacy-hash',
			'11111111-1111-4111-8111-111111111111'
		);
	`); err != nil {
		t.Fatal(err)
	}
	body, err := files.ReadFile("039_task_idempotency_request_data.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO tasks (id, title, description, kind, parent_task_id)
		VALUES (
			'44444444-4444-4444-8444-444444444444',
			'Created after migration', '', 'action',
			'22222222-2222-4222-8222-222222222222'
		);
		INSERT INTO task_idempotency_keys (user_id, key, request_hash, task_id)
		VALUES (
			'33333333-3333-4333-8333-333333333333', 'old-writer-after-migration', 'old-writer-hash',
			'44444444-4444-4444-8444-444444444444'
		);
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE tasks SET title = 'Edited child'`); err != nil {
		t.Fatal(err)
	}

	var requestDataHash string
	if err := tx.QueryRow(ctx, `
		SELECT request_data_hash
		FROM task_idempotency_keys
		WHERE key = 'legacy-child'
	`).Scan(&requestDataHash); err != nil {
		t.Fatal(err)
	}
	if requestDataHash != "67a9a9acb5baf4b68dff5efe911acaf0886c3b760037551ba62c922bbb724778" {
		t.Fatalf("request snapshot hash = %q", requestDataHash)
	}
	var oldWriterHash string
	if err := tx.QueryRow(ctx, `
		SELECT request_data_hash
		FROM task_idempotency_keys
		WHERE key = 'old-writer-after-migration'
	`).Scan(&oldWriterHash); err != nil {
		t.Fatal(err)
	}
	if len(oldWriterHash) != 64 {
		t.Fatalf("old-writer request snapshot hash = %q", oldWriterHash)
	}
}
