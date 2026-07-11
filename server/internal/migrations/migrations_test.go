package migrations

import (
	"context"
	"os"
	"testing"

	"github.com/owainlewis/slate.do/server/internal/database"
)

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

func TestNeutralItemsMigrationPreservesExistingTasksAsActions(t *testing.T) {
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
		CREATE TEMP TABLE tasks (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			title text NOT NULL,
			sort_order integer NOT NULL DEFAULT 0,
			created_at timestamptz NOT NULL DEFAULT now()
		);
		INSERT INTO tasks (title) VALUES ('Existing task');
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

	var existingKind string
	if err := tx.QueryRow(ctx, "SELECT kind FROM tasks WHERE title = 'Existing task'").Scan(&existingKind); err != nil {
		t.Fatal(err)
	}
	if existingKind != "action" {
		t.Fatalf("existing kind = %q, want action", existingKind)
	}
	var newKind string
	if err := tx.QueryRow(ctx, "INSERT INTO tasks (title) VALUES ('New item') RETURNING kind").Scan(&newKind); err != nil {
		t.Fatal(err)
	}
	if newKind != "item" {
		t.Fatalf("new kind = %q, want item", newKind)
	}
	var goal string
	if err := tx.QueryRow(ctx, "INSERT INTO buckets DEFAULT VALUES RETURNING goal").Scan(&goal); err != nil {
		t.Fatal(err)
	}
	if goal != "" {
		t.Fatalf("default goal = %q", goal)
	}
}
