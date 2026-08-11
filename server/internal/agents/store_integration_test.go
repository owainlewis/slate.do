package agents

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/migrations"
)

func TestDetailAndWorkStayOwnerScoped(t *testing.T) {
	ctx, db := agentTestDatabase(t)
	authStore := auth.NewPGStore(db)
	store := NewStore(db, authStore)
	stamp := time.Now().UnixNano()
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-detail-owner-%d@slate.test", stamp), "hash")
	if err != nil {
		t.Fatal(err)
	}
	other, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-detail-other-%d@slate.test", stamp), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id IN ($1, $2)", owner.ID, other.ID)
	})
	agent, err := authStore.CreateAgent(ctx, owner.ID, "Builder", "Ships work", lifecycleHash("detail"), "detail")
	if err != nil {
		t.Fatal(err)
	}
	foreignAgent, err := authStore.CreateAgent(ctx, other.ID, "Foreign", "", lifecycleHash("foreign"), "foreign")
	if err != nil {
		t.Fatal(err)
	}
	boardID, bucketID := insertBoardAndBucket(t, ctx, db, owner.ID, "Agent work")
	for index, status := range []string{"queued", "working", "needs_review", "done"} {
		insertAssignedTask(t, ctx, db, boardID, bucketID, agent.ID, fmt.Sprintf("Card %d", index), status, time.Now().Add(time.Duration(index)*time.Second))
	}

	detail, err := store.GetDetail(ctx, owner.ID, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Agent.ID != agent.ID || detail.Work.Totals.Ready != 1 || detail.Work.Totals.Working != 1 || detail.Work.Totals.Review != 1 || detail.Work.Totals.Completed != 1 {
		t.Fatalf("detail = %#v", detail)
	}
	page, err := store.ListWork(ctx, owner.ID, agent.ID, 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 4 || len(page.Items) != 2 || !page.HasNext {
		t.Fatalf("work page = %#v", page)
	}
	if _, err := store.GetDetail(ctx, owner.ID, foreignAgent.ID); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("foreign detail error = %v", err)
	}
}

func TestCredentialLifecycleIsOwnerScopedAndIdempotent(t *testing.T) {
	ctx, db := agentTestDatabase(t)
	authStore := auth.NewPGStore(db)
	store := NewStore(db, authStore)
	stamp := time.Now().UnixNano()
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-credential-owner-%d@slate.test", stamp), "hash")
	if err != nil {
		t.Fatal(err)
	}
	other, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-credential-other-%d@slate.test", stamp), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id IN ($1, $2)", owner.ID, other.ID)
	})
	agent, err := authStore.CreateAgent(ctx, owner.ID, "Builder", "", lifecycleHash("old"), "old")
	if err != nil {
		t.Fatal(err)
	}
	foreignAgent, err := authStore.CreateAgent(ctx, other.ID, "Foreign", "", lifecycleHash("foreign"), "foreign")
	if err != nil {
		t.Fatal(err)
	}

	credential, applied, err := store.RotateCredential(ctx, owner.ID, agent.ID, "rotation-key-0000000000000001", lifecycleHash("new"), "new")
	if err != nil || !applied {
		t.Fatalf("rotation = %#v, applied = %t, error = %v", credential, applied, err)
	}
	replayed, applied, err := store.RotateCredential(ctx, owner.ID, agent.ID, "rotation-key-0000000000000001", lifecycleHash("discarded"), "discarded")
	if err != nil || applied || replayed.ID != credential.ID {
		t.Fatalf("replay = %#v, applied = %t, error = %v", replayed, applied, err)
	}
	if _, _, err := store.RotateCredential(ctx, owner.ID, foreignAgent.ID, "rotation-key-0000000000000002", lifecycleHash("other"), "other"); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("cross-owner rotation error = %v", err)
	}
	if err := store.RevokeCredential(ctx, owner.ID, agent.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.RevokeCredential(ctx, owner.ID, agent.ID); err != nil {
		t.Fatalf("idempotent revoke: %v", err)
	}
	if _, err := authStore.FindUserByAPITokenHash(ctx, lifecycleHash("new"), time.Now()); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatalf("revoked credential still authenticates: %v", err)
	}
}

func TestDetailAndWorkAreBoundedPaginatedAndPreserveChildContext(t *testing.T) {
	ctx, db := agentTestDatabase(t)
	authStore := auth.NewPGStore(db)
	store := NewStore(db, authStore)
	stamp := time.Now().UnixNano()
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-bounds-owner-%d@slate.test", stamp), "hash")
	if err != nil {
		t.Fatal(err)
	}
	other, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-bounds-other-%d@slate.test", stamp), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id IN ($1, $2)", owner.ID, other.ID)
	})
	agent, err := authStore.CreateAgent(ctx, owner.ID, "Bounded", "", lifecycleHash("bounded"), "bounded")
	if err != nil {
		t.Fatal(err)
	}
	boardID, bucketID := insertBoardAndBucket(t, ctx, db, owner.ID, "Bounded work")
	otherBoardID, otherBucketID := insertBoardAndBucket(t, ctx, db, other.ID, "Foreign work")
	var parentID, childID string
	if err := db.QueryRow(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, kind, status)
		VALUES ($1, $2, 'Parent card', 'action', 'new') RETURNING id::text
	`, boardID, bucketID).Scan(&parentID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `
		INSERT INTO tasks (board_id, bucket_id, parent_task_id, title, kind, status, assignee_agent_id)
		VALUES ($1, $2, $3, 'Child card', 'action', 'queued', $4) RETURNING id::text
	`, boardID, bucketID, parentID, agent.ID).Scan(&childID); err != nil {
		t.Fatal(err)
	}
	for index := range 55 {
		insertAssignedTask(t, ctx, db, boardID, bucketID, agent.ID, fmt.Sprintf("Queued %02d", index), "queued", time.Now().Add(time.Duration(index)*time.Millisecond))
	}
	insertAssignedTask(t, ctx, db, otherBoardID, otherBucketID, agent.ID, "Foreign card", "queued", time.Now())

	detail, err := store.GetDetail(ctx, owner.ID, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Work.Totals.Ready != 56 || len(detail.Work.Ready) != InitialOpenLimit {
		t.Fatalf("bounded detail totals=%#v ready=%d", detail.Work.Totals, len(detail.Work.Ready))
	}
	first, err := store.ListWork(ctx, owner.ID, agent.ID, 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.ListWork(ctx, owner.ID, agent.ID, 2, 50)
	if err != nil {
		t.Fatal(err)
	}
	if first.Total != 56 || len(first.Items) != 50 || !first.HasNext || first.HasPrevious || len(second.Items) != 6 || second.HasNext || !second.HasPrevious {
		t.Fatalf("pages = %#v / %#v", first, second)
	}
	foundChild := false
	for _, item := range append(first.Items, second.Items...) {
		if item.Title == "Foreign card" {
			t.Fatal("cross-owner task leaked into agent work")
		}
		if item.ID == childID {
			foundChild = item.ParentTaskID == parentID
		}
	}
	if !foundChild {
		t.Fatal("child card lost its parent context")
	}
}

func TestAgentIdentityUpdatesStayOwnerScopedAndUnique(t *testing.T) {
	ctx, db := agentTestDatabase(t)
	authStore := auth.NewPGStore(db)
	store := NewStore(db, authStore)
	stamp := time.Now().UnixNano()
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-update-owner-%d@slate.test", stamp), "hash")
	if err != nil {
		t.Fatal(err)
	}
	other, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-update-other-%d@slate.test", stamp), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id IN ($1, $2)", owner.ID, other.ID)
	})
	agent, err := authStore.CreateAgent(ctx, owner.ID, "Builder", "", lifecycleHash("builder"), "builder")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authStore.CreateAgent(ctx, owner.ID, "Research", "", lifecycleHash("research"), "research"); err != nil {
		t.Fatal(err)
	}
	foreign, err := authStore.CreateAgent(ctx, other.ID, "Foreign", "", lifecycleHash("foreign-update"), "foreign")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := store.UpdateAgent(ctx, owner.ID, agent.ID, "Builder Prime", "Ships cards")
	if err != nil || updated.DisplayName != "Builder Prime" || updated.Purpose != "Ships cards" {
		t.Fatalf("updated agent = %#v, error = %v", updated, err)
	}
	if _, err := store.UpdateAgent(ctx, owner.ID, agent.ID, "research", ""); !errors.Is(err, auth.ErrAgentNameTaken) {
		t.Fatalf("duplicate name error = %v", err)
	}
	if _, err := store.UpdateAgent(ctx, owner.ID, foreign.ID, "Stolen", ""); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("cross-owner update error = %v", err)
	}
}

func TestConcurrentCredentialRotationCreatesOneActiveCredential(t *testing.T) {
	ctx, db := agentTestDatabase(t)
	authStore := auth.NewPGStore(db)
	store := NewStore(db, authStore)
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-rotation-owner-%d@slate.test", time.Now().UnixNano()), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", owner.ID) })
	agent, err := authStore.CreateAgent(ctx, owner.ID, "Concurrent", "", lifecycleHash("initial"), "initial")
	if err != nil {
		t.Fatal(err)
	}
	type result struct {
		credential auth.AgentCredential
		applied    bool
		err        error
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	for index := range 2 {
		go func() {
			<-start
			credential, applied, err := store.RotateCredential(ctx, owner.ID, agent.ID, "concurrent-rotation-key-0001", lifecycleHash(fmt.Sprintf("candidate-%d", index)), fmt.Sprintf("candidate-%d", index))
			results <- result{credential: credential, applied: applied, err: err}
		}()
	}
	close(start)
	first, second := <-results, <-results
	if first.err != nil || second.err != nil || first.credential.ID != second.credential.ID || first.applied == second.applied {
		t.Fatalf("concurrent rotations = %#v / %#v", first, second)
	}
	var activeCredentials int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM agent_credentials WHERE agent_id = $1 AND revoked_at IS NULL", agent.ID).Scan(&activeCredentials); err != nil {
		t.Fatal(err)
	}
	if activeCredentials != 1 {
		t.Fatalf("active credentials = %d, want 1", activeCredentials)
	}
}

func agentTestDatabase(t *testing.T) (context.Context, *database.Pool) {
	t.Helper()
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run agent integration tests")
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
	return ctx, db
}

func lifecycleHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", sum[:])
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

func insertAssignedTask(t *testing.T, ctx context.Context, db *database.Pool, boardID, bucketID, agentID, title, status string, updatedAt time.Time) {
	t.Helper()
	if _, err := db.Exec(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, kind, status, assignee_agent_id, sort_order, created_at, updated_at)
		VALUES ($1, $2, $3, 'action', $4, $5, 0, $6, $6)
	`, boardID, bucketID, title, status, agentID, updatedAt); err != nil {
		t.Fatal(err)
	}
}
