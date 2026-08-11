package boards

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/database"
)

func TestCompletedHistoryPaginationIsBoundedStableAndScoped(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	ownerID := createIntegrationUser(t, ctx, db)
	otherID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id IN ($1, $2)", ownerID, otherID)
	})

	board, err := store.CreateBoard(ctx, ownerID, CreateBoardInput{Name: "History"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, ownerID, board.ID, CreateBucketInput{Name: "Completed"})
	if err != nil {
		t.Fatal(err)
	}
	filter := TaskFilter{BucketID: bucket.ID, Status: StatusDone}
	empty, err := store.ListTaskPage(ctx, ownerID, filter)
	if err != nil || len(empty.Tasks) != 0 || empty.NextCursor != "" {
		t.Fatalf("empty history = %#v err=%v", empty, err)
	}

	base := time.Date(2035, time.January, 1, 12, 0, 0, 0, time.UTC)
	completedIDs := make([]string, 0, 45)
	for index := 0; index < 20; index++ {
		completedIDs = append(completedIDs, insertHistoryTask(t, ctx, db, board.ID, bucket.ID, "", index, base.Add(time.Duration(index)*time.Minute)))
	}
	exact, err := store.ListTaskPage(ctx, ownerID, filter)
	if err != nil || len(exact.Tasks) != 20 || exact.NextCursor != "" {
		t.Fatalf("exact boundary = %#v err=%v", exact, err)
	}
	for index := 20; index < 45; index++ {
		completedIDs = append(completedIDs, insertHistoryTask(t, ctx, db, board.ID, bucket.ID, "", index, base.Add(time.Duration(index)*time.Minute)))
	}

	first, err := store.ListTaskPage(ctx, ownerID, filter)
	if err != nil || len(first.Tasks) != 20 || first.NextCursor == "" {
		t.Fatalf("first history page = %#v err=%v", first, err)
	}
	firstIDs := taskIDs(first.Tasks)
	if first.Tasks[0].ID != completedIDs[44] || first.Tasks[19].ID != completedIDs[25] {
		t.Fatalf("first history ordering = %v", firstIDs)
	}
	for _, task := range first.Tasks {
		if task.Description != "" {
			t.Fatalf("collection returned description for %s", task.ID)
		}
	}

	// A completed task updated after the cursor moves into the refreshed first
	// page and must not be duplicated in this continuation.
	if _, err := db.Exec(ctx, "UPDATE tasks SET updated_at = $2 WHERE id = $1", completedIDs[24], base.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	secondFilter := filter
	secondFilter.Cursor = first.NextCursor
	second, err := store.ListTaskPage(ctx, ownerID, secondFilter)
	if err != nil || len(second.Tasks) != 20 || second.NextCursor == "" {
		t.Fatalf("second history page = %#v err=%v", second, err)
	}
	for _, task := range second.Tasks {
		if firstIDs[task.ID] {
			t.Fatalf("cursor duplicated task %s after concurrent update", task.ID)
		}
	}
	if containsTask(second.Tasks, completedIDs[24]) {
		t.Fatalf("task updated ahead of cursor appeared in continuation: %s", completedIDs[24])
	}
	thirdFilter := filter
	thirdFilter.Cursor = second.NextCursor
	third, err := store.ListTaskPage(ctx, ownerID, thirdFilter)
	if err != nil || len(third.Tasks) != 4 || third.NextCursor != "" {
		t.Fatalf("final history page = %#v err=%v", third, err)
	}

	detail, err := store.GetTask(ctx, ownerID, completedIDs[44])
	if err != nil || detail.Description != "full description 44" {
		t.Fatalf("exact task detail = %#v err=%v", detail, err)
	}
	encoded, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "description") {
		t.Fatalf("collection JSON included descriptions: %s", encoded)
	}

	otherBoard, err := store.CreateBoard(ctx, otherID, CreateBoardInput{Name: "Other"})
	if err != nil {
		t.Fatal(err)
	}
	otherBucket, err := store.CreateBucket(ctx, otherID, otherBoard.ID, CreateBucketInput{Name: "Other"})
	if err != nil {
		t.Fatal(err)
	}
	foreignID := insertHistoryTask(t, ctx, db, otherBoard.ID, otherBucket.ID, "", 99, base.Add(24*time.Hour))
	ownerHistory, err := store.ListTaskPage(ctx, ownerID, TaskFilter{Status: StatusDone, Limit: 100})
	if err != nil || containsTask(ownerHistory.Tasks, foreignID) {
		t.Fatalf("tenant-scoped history = %#v err=%v", ownerHistory, err)
	}

	var firstAgentID, secondAgentID string
	if err := db.QueryRow(ctx, "INSERT INTO agents (owner_user_id, name) VALUES ($1, 'First') RETURNING id::text", ownerID).Scan(&firstAgentID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, "INSERT INTO agents (owner_user_id, name) VALUES ($1, 'Second') RETURNING id::text", ownerID).Scan(&secondAgentID); err != nil {
		t.Fatal(err)
	}
	firstAssigned := insertHistoryTask(t, ctx, db, board.ID, bucket.ID, firstAgentID, 100, base.Add(25*time.Hour))
	secondAssigned := insertHistoryTask(t, ctx, db, board.ID, bucket.ID, secondAgentID, 101, base.Add(26*time.Hour))
	agentPage, err := store.ListTaskPage(ctx, ownerID, TaskFilter{Status: StatusDone, AssigneeAgentID: firstAgentID})
	if err != nil || !containsTask(agentPage.Tasks, firstAssigned) || containsTask(agentPage.Tasks, secondAssigned) {
		t.Fatalf("agent-scoped history = %#v err=%v", agentPage, err)
	}
	wrongScope := TaskFilter{Status: StatusDone, AssigneeAgentID: secondAgentID, Cursor: first.NextCursor}
	if _, err := store.ListTaskPage(ctx, ownerID, wrongScope); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("cross-scope cursor error = %v", err)
	}
}

func TestBoardResponseIsBoundedAtStoredTaskCeiling(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })
	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Ceiling"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "All tasks"})
	if err != nil {
		t.Fatal(err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT set_config('slate.storage_quota_managed', 'on', true)"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, description, kind, status, sort_order, updated_at)
		SELECT $1, $2, 'Task ' || generated, repeat('x', 1024), 'action',
			CASE WHEN generated > 20 THEN 'done' ELSE 'queued' END, generated,
			$3::timestamptz + generated * interval '1 second'
		FROM generate_series(1, 10000) generated
	`, board.ID, bucket.ID, time.Date(2036, time.January, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	loaded, err := store.GetBoard(ctx, userID, board.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Buckets) != 1 || len(loaded.Buckets[0].Tasks) != 40 || loaded.Buckets[0].CompletedNextCursor == "" {
		t.Fatalf("bounded board rows = %#v", loaded.Buckets)
	}
	defaultPage, err := store.ListTaskPage(ctx, userID, TaskFilter{BucketID: bucket.ID, Status: StatusDone})
	if err != nil || len(defaultPage.Tasks) != 20 || defaultPage.NextCursor == "" {
		t.Fatalf("default ceiling page rows=%d cursor=%t err=%v", len(defaultPage.Tasks), defaultPage.NextCursor != "", err)
	}
	maximumPage, err := store.ListTaskPage(ctx, userID, TaskFilter{BucketID: bucket.ID, Status: StatusDone, Limit: 1000})
	if err != nil || len(maximumPage.Tasks) != 100 || maximumPage.NextCursor == "" {
		t.Fatalf("maximum ceiling page rows=%d cursor=%t err=%v", len(maximumPage.Tasks), maximumPage.NextCursor != "", err)
	}
	encoded, err := json.Marshal(loaded)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > 64*1024 || strings.Contains(string(encoded), "description") || strings.Contains(string(encoded), strings.Repeat("x", 128)) {
		t.Fatalf("bounded board payload bytes=%d", len(encoded))
	}
}

func insertHistoryTask(t *testing.T, ctx context.Context, db *database.Pool, boardID, bucketID, agentID string, index int, updatedAt time.Time) string {
	t.Helper()
	var id string
	err := db.QueryRow(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, description, kind, status, sort_order, assignee_agent_id, updated_at)
		VALUES ($1, $2, $3, $4, 'action', 'done', $5, NULLIF($6, '')::uuid, $7)
		RETURNING id::text
	`, boardID, bucketID, fmt.Sprintf("Completed %02d", index), fmt.Sprintf("full description %d", index), index, agentID, updatedAt).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func taskIDs(tasks []Task) map[string]bool {
	result := make(map[string]bool, len(tasks))
	for _, task := range tasks {
		result[task.ID] = true
	}
	return result
}

func containsTask(tasks []Task, id string) bool {
	for _, task := range tasks {
		if task.ID == id {
			return true
		}
	}
	return false
}
