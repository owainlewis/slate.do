package agents

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/migrations"
)

func TestDetailAndWorkStayOwnerScopedGroupedAndBounded(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run agent detail integration tests")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}

	authStore := auth.NewPGStore(db)
	stamp := time.Now().UnixNano()
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-detail-owner-%d@slate.test", stamp), "password-hash")
	if err != nil {
		t.Fatal(err)
	}
	other, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-detail-other-%d@slate.test", stamp), "password-hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = ANY($1::uuid[])", []string{owner.ID, other.ID})
	})
	agent, err := authStore.CreateAgent(ctx, owner.ID, "Builder", "Ships focused work", "owner-agent-hash", "slate_agent_owner")
	if err != nil {
		t.Fatal(err)
	}
	foreignAgent, err := authStore.CreateAgent(ctx, other.ID, "Other builder", "", "other-agent-hash", "slate_agent_other")
	if err != nil {
		t.Fatal(err)
	}
	ownerBoard, ownerBucket := insertBoardAndBucket(t, ctx, db, owner.ID, "Owner board")
	foreignBoard, foreignBucket := insertBoardAndBucket(t, ctx, db, other.ID, "Other board")

	for index := range 55 {
		insertAssignedTask(t, ctx, db, ownerBoard, ownerBucket, agent.ID, fmt.Sprintf("Ready %02d", index), "queued", false, time.Now().Add(time.Duration(index)*time.Second))
	}
	insertAssignedTask(t, ctx, db, ownerBoard, ownerBucket, agent.ID, "Current working", "working", false, time.Now().Add(time.Hour))
	insertAssignedTask(t, ctx, db, ownerBoard, ownerBucket, agent.ID, "Waiting for review", "needs_review", false, time.Now().Add(2*time.Hour))
	for index := range 25 {
		insertAssignedTask(t, ctx, db, ownerBoard, ownerBucket, agent.ID, fmt.Sprintf("Completed %02d", index), "done", true, time.Now().Add(time.Duration(index)*time.Minute))
	}
	// Deliberately create an invalid cross-owner assignment. Every detail query
	// must still exclude it through the board owner join.
	insertAssignedTask(t, ctx, db, foreignBoard, foreignBucket, agent.ID, "Foreign task", "working", false, time.Now().Add(3*time.Hour))

	store := NewStore(db, authStore)
	detail, err := store.GetDetail(ctx, owner.ID, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Agent.ID != agent.ID || detail.Agent.DisplayName != "Builder" {
		t.Fatalf("agent = %#v", detail.Agent)
	}
	if detail.Work.Totals != (WorkTotals{Ready: 55, Working: 1, Review: 1, Completed: 25}) {
		t.Fatalf("totals = %#v", detail.Work.Totals)
	}
	if got := len(detail.Work.Ready) + len(detail.Work.Working) + len(detail.Work.Review); got != InitialOpenLimit {
		t.Fatalf("initial open items = %d, want %d", got, InitialOpenLimit)
	}
	if len(detail.Work.Working) != 1 || len(detail.Work.Review) != 1 || len(detail.Work.Ready) != 48 {
		t.Fatalf("initial groups = ready %d, working %d, review %d", len(detail.Work.Ready), len(detail.Work.Working), len(detail.Work.Review))
	}
	if len(detail.Work.RecentlyCompleted) != InitialCompletedLimit || detail.Work.RecentlyCompleted[0].Title != "Completed 24" {
		t.Fatalf("recent completed = %d, first %#v", len(detail.Work.RecentlyCompleted), detail.Work.RecentlyCompleted[0])
	}

	first, err := store.ListWork(ctx, owner.ID, agent.ID, 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.ListWork(ctx, owner.ID, agent.ID, 2, 10)
	if err != nil {
		t.Fatal(err)
	}
	if first.Total != 82 || len(first.Items) != 10 || !first.HasNext || first.HasPrevious {
		t.Fatalf("first page = %#v", first)
	}
	if len(second.Items) != 10 || !second.HasNext || !second.HasPrevious || first.Items[9].ID == second.Items[0].ID {
		t.Fatalf("second page = %#v", second)
	}
	for _, item := range append(first.Items, second.Items...) {
		if item.Title == "Foreign task" {
			t.Fatal("cross-owner task leaked into work page")
		}
	}

	if _, err := store.GetDetail(ctx, owner.ID, foreignAgent.ID); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("foreign agent error = %v, want not found", err)
	}
	if _, err := store.GetDetail(ctx, owner.ID, "00000000-0000-0000-0000-000000000000"); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("missing agent error = %v, want not found", err)
	}
	if _, err := db.Exec(ctx, "UPDATE agents SET archived_at = now() WHERE id = $1", agent.ID); err != nil {
		t.Fatal(err)
	}
	archived, err := store.GetDetail(ctx, owner.ID, agent.ID)
	if err != nil || archived.Agent.ArchivedAt == nil || archived.Work.Totals.Completed != 25 {
		t.Fatalf("archived detail = %#v, error = %v", archived, err)
	}
}

func insertBoardAndBucket(t *testing.T, ctx context.Context, db *database.Pool, userID string, name string) (string, string) {
	t.Helper()
	var boardID, bucketID string
	if err := db.QueryRow(ctx, `
		INSERT INTO boards (user_id, name, max_tasks_per_list)
		VALUES ($1, $2, 20)
		RETURNING id::text
	`, userID, name).Scan(&boardID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `
		INSERT INTO buckets (board_id, name, limit_count)
		VALUES ($1, 'Inbox', 20)
		RETURNING id::text
	`, boardID).Scan(&bucketID); err != nil {
		t.Fatal(err)
	}
	return boardID, bucketID
}

func insertAssignedTask(t *testing.T, ctx context.Context, db *database.Pool, boardID string, bucketID string, agentID string, title string, status string, done bool, updatedAt time.Time) {
	t.Helper()
	if _, err := db.Exec(ctx, `
		INSERT INTO tasks (
			board_id, bucket_id, title, kind, done, status, assignee_agent_id,
			sort_order, created_at, updated_at
		)
		VALUES ($1, $2, $3, 'action', $4, $5, $6, 0, $7, $7)
	`, boardID, bucketID, title, done, status, agentID, updatedAt); err != nil {
		t.Fatal(err)
	}
}
