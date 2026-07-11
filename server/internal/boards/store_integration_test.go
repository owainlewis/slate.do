package boards

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/migrations"
)

func TestBoardMaxTasksPerListAppliesToAllBuckets(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Limits", MaxTasksPerList: 2})
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "First", LimitCount: 99})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Second", LimitCount: 1})
	if err != nil {
		t.Fatal(err)
	}

	for i := 1; i <= 2; i++ {
		if _, err := store.CreateTask(ctx, userID, first.ID, CreateTaskInput{Title: fmt.Sprintf("first %d", i), Kind: KindAction}); err != nil {
			t.Fatal(err)
		}
		if _, err := store.CreateTask(ctx, userID, second.ID, CreateTaskInput{Title: fmt.Sprintf("second %d", i), Kind: KindAction}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.CreateTask(ctx, userID, first.ID, CreateTaskInput{Title: "too many", Kind: KindAction}); !errors.Is(err, ErrLimitFull) {
		t.Fatalf("first list error = %v, want ErrLimitFull", err)
	}
	if _, err := store.CreateTask(ctx, userID, second.ID, CreateTaskInput{Title: "too many", Kind: KindAction}); !errors.Is(err, ErrLimitFull) {
		t.Fatalf("second list error = %v, want ErrLimitFull", err)
	}

	next := 3
	if _, err := store.UpdateBoard(ctx, userID, board.ID, UpdateBoardInput{MaxTasksPerList: &next}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateTask(ctx, userID, first.ID, CreateTaskInput{Title: "now allowed", Kind: KindAction}); err != nil {
		t.Fatal(err)
	}
}

func TestCreateBoardDefaultsToTwentyTasksPerList(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Default limit"})
	if err != nil {
		t.Fatal(err)
	}
	if board.MaxTasksPerList != 20 {
		t.Fatalf("MaxTasksPerList = %d, want 20", board.MaxTasksPerList)
	}
}

func TestNeutralItemsAndActionLimits(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Operating plan", MaxTasksPerList: 1})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "YouTube", Goal: "Publish one strong video each week"})
	if err != nil {
		t.Fatal(err)
	}
	otherBucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "LinkedIn"})
	if err != nil {
		t.Fatal(err)
	}
	reference, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Cameras I am considering"})
	if err != nil {
		t.Fatal(err)
	}
	if reference.Kind != KindItem {
		t.Fatalf("default kind = %q, want item", reference.Kind)
	}
	camera, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Sony FX3"})
	if err != nil {
		t.Fatal(err)
	}
	if camera.Kind != KindItem {
		t.Fatalf("camera kind = %q, want item", camera.Kind)
	}
	if _, err := store.UpdateTask(ctx, userID, camera.ID, UpdateTaskInput{BucketID: &otherBucket.ID}); err != nil {
		t.Fatalf("move flat item: %v", err)
	}
	if err := store.ReorderTasks(ctx, userID, otherBucket.ID, []string{reference.ID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-list reorder error = %v, want ErrNotFound", err)
	}
	action, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Record camera comparison", Kind: KindAction})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Second action", Kind: KindAction}); !errors.Is(err, ErrLimitFull) {
		t.Fatalf("second action error = %v, want ErrLimitFull", err)
	}
	updatedTitle := "Record the camera comparison"
	unchangedKind := KindAction
	if _, err := store.UpdateTask(ctx, userID, action.ID, UpdateTaskInput{Title: &updatedTitle, Kind: &unchangedKind, BucketID: &bucket.ID}); err != nil {
		t.Fatalf("edit existing action in full list: %v", err)
	}
	completeAction := true
	if _, err := store.UpdateTask(ctx, userID, action.ID, UpdateTaskInput{Done: &completeAction}); err != nil {
		t.Fatal(err)
	}
	replacement, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Replacement action", Kind: KindAction})
	if err != nil {
		t.Fatal(err)
	}
	reopenAction := false
	if _, err := store.UpdateTask(ctx, userID, action.ID, UpdateTaskInput{Done: &reopenAction}); !errors.Is(err, ErrLimitFull) {
		t.Fatalf("reopen action in full list error = %v, want ErrLimitFull", err)
	}
	if err := store.DeleteTask(ctx, userID, replacement.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateTask(ctx, userID, action.ID, UpdateTaskInput{Done: &reopenAction}); err != nil {
		t.Fatalf("reopen action with capacity: %v", err)
	}
	done := true
	if _, err := store.UpdateTask(ctx, userID, reference.ID, UpdateTaskInput{Done: &done}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("complete item error = %v, want ErrInvalidData", err)
	}
	if _, err := store.ClaimTask(ctx, userID, reference.ID); !errors.Is(err, ErrTaskUnavailable) {
		t.Fatalf("claim item error = %v, want ErrTaskUnavailable", err)
	}
	actions, err := store.ListTasks(ctx, userID, TaskFilter{ActionsOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 1 || actions[0].ID != action.ID {
		t.Fatalf("actions = %#v, want only %q", actions, action.ID)
	}
	loaded, err := store.GetBoard(ctx, userID, board.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Buckets[0].Goal != "Publish one strong video each week" || loaded.Buckets[0].OpenCount != 1 {
		t.Fatalf("loaded bucket = %#v", loaded.Buckets[0])
	}
}

func TestAnyQueuedTaskCanBeClaimed(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Shared work"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Work"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{
		Title: "Review positioning", Description: "Compare the three strongest options.", ScheduledDate: "2026-07-13", Kind: KindAction,
	})
	if err != nil {
		t.Fatal(err)
	}
	if task.Description != "Compare the three strongest options." || task.ScheduledDate != "2026-07-13" || task.Status != StatusQueued {
		t.Fatalf("created task = %#v", task)
	}

	tasks, err := store.ListTasks(ctx, userID, TaskFilter{Status: StatusQueued})
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].ID != task.ID {
		t.Fatalf("queued tasks = %#v, want created task", tasks)
	}

	working := StatusWorking
	if _, err := store.UpdateTask(ctx, userID, task.ID, UpdateTaskInput{Status: &working}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("direct working status error = %v, want ErrInvalidData", err)
	}

	claimed, err := store.ClaimTask(ctx, userID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if claimed.Status != StatusWorking {
		t.Fatalf("claimed status = %q, want %q", claimed.Status, StatusWorking)
	}
	if _, err := store.ClaimTask(ctx, userID, task.ID); !errors.Is(err, ErrTaskUnavailable) {
		t.Fatalf("second claim error = %v, want ErrTaskUnavailable", err)
	}

	done := true
	description := "Chosen direction and rationale."
	needsReview := StatusNeedsReview
	noDate := ""
	completed, err := store.UpdateTask(ctx, userID, task.ID, UpdateTaskInput{Description: &description, ScheduledDate: &noDate, Done: &done, Status: &needsReview})
	if err != nil {
		t.Fatal(err)
	}
	if !completed.Done || completed.Status != StatusDone || completed.Description != description || completed.ScheduledDate != "" {
		t.Fatalf("completed task = %#v, want done task with updated description", completed)
	}
}

func openIntegrationDB(t *testing.T) *database.Pool {
	t.Helper()
	url := os.Getenv("SLATE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run board store integration tests")
	}
	db, err := database.Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := migrations.Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	return db
}

func createIntegrationUser(t *testing.T, ctx context.Context, db *database.Pool) string {
	t.Helper()
	email := fmt.Sprintf("%s-%d@slate.test", strings.ToLower(t.Name()), time.Now().UnixNano())
	var id string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'test')
		RETURNING id::text
	`, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
