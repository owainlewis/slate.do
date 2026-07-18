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

func TestCreateBoardEnforcesDefaultBoardLimit(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	for index := 0; index < defaultMaxBoards; index++ {
		if _, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: fmt.Sprintf("Board %d", index+1)}); err != nil {
			t.Fatalf("create board %d: %v", index+1, err)
		}
	}
	if _, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "One too many"}); !errors.Is(err, ErrBoardLimit) {
		t.Fatalf("create board above limit error = %v, want ErrBoardLimit", err)
	}
}

func TestUnifiedListItemsAndActionLimits(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Operating plan", MaxTasksPerList: 2})
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
	if reference.Kind != KindAction {
		t.Fatalf("default kind = %q, want action", reference.Kind)
	}
	camera, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Sony FX3"})
	if err != nil {
		t.Fatal(err)
	}
	if camera.Kind != KindAction {
		t.Fatalf("camera kind = %q, want action", camera.Kind)
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
	claimed, err := store.ClaimTask(ctx, userID, reference.ID)
	if err != nil {
		t.Fatalf("claim default list item: %v", err)
	}
	if claimed.Status != StatusWorking {
		t.Fatalf("claimed status = %q, want working", claimed.Status)
	}
	actions, err := store.ListTasks(ctx, userID, TaskFilter{ActionsOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 3 {
		t.Fatalf("actions = %#v, want all three list items", actions)
	}
	loaded, err := store.GetBoard(ctx, userID, board.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Buckets[0].Goal != "Publish one strong video each week" || loaded.Buckets[0].OpenCount != 2 {
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

func TestHumanStatusTransitionsPersistWithoutMovingHomeList(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Flow", MaxTasksPerList: 1})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Home"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Move through flow", Kind: KindAction})
	if err != nil {
		t.Fatal(err)
	}

	for _, status := range []string{StatusWorking, StatusNeedsReview, StatusDone, StatusQueued} {
		updated, err := store.UpdateTaskForHuman(ctx, userID, task.ID, UpdateTaskInput{Status: &status})
		if err != nil {
			t.Fatalf("set %q: %v", status, err)
		}
		if updated.Status != status || updated.Done != (status == StatusDone) {
			t.Fatalf("updated task = %#v", updated)
		}
		if updated.BucketID != bucket.ID {
			t.Fatalf("bucket = %q after %q, want %q", updated.BucketID, status, bucket.ID)
		}
		loaded, err := store.GetTask(ctx, userID, task.ID)
		if err != nil {
			t.Fatal(err)
		}
		if loaded.Status != status || loaded.BucketID != bucket.ID {
			t.Fatalf("persisted task after %q = %#v", status, loaded)
		}
	}

	target, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Target"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateTask(ctx, userID, target.ID, CreateTaskInput{Title: "Target blocker", Kind: KindAction}); err != nil {
		t.Fatal(err)
	}
	done := StatusDone
	movedTitle := "Moved and completed"
	updated, err := store.UpdateTaskForHuman(ctx, userID, task.ID, UpdateTaskInput{Title: &movedTitle, BucketID: &target.ID, Status: &done})
	if err != nil {
		t.Fatalf("atomically move into full list and complete: %v", err)
	}
	if updated.Title != movedTitle || updated.BucketID != target.ID || !updated.Done {
		t.Fatalf("atomic update = %#v", updated)
	}
	if _, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Home blocker", Kind: KindAction}); err != nil {
		t.Fatal(err)
	}
	queued := StatusQueued
	reopenedTitle := "Should not persist"
	if _, err := store.UpdateTaskForHuman(ctx, userID, task.ID, UpdateTaskInput{Title: &reopenedTitle, BucketID: &bucket.ID, Status: &queued}); !errors.Is(err, ErrLimitFull) {
		t.Fatalf("reopen into full list error = %v, want ErrLimitFull", err)
	}
	loaded, err := store.GetTask(ctx, userID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Title != movedTitle || loaded.BucketID != target.ID || loaded.Status != StatusDone {
		t.Fatalf("failed atomic update persisted partially: %#v", loaded)
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
