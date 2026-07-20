package boards

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/migrations"
)

func TestConcurrentProResourceCreationCannotExceedLimits(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	boardResults := runConcurrently(12, func(index int) error {
		_, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: fmt.Sprintf("Board %d", index)})
		return err
	})
	assertConcurrentResults(t, boardResults, defaultMaxBoards, ErrBoardLimit)

	boards, err := store.ListBoards(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	listResults := runConcurrently(15, func(index int) error {
		_, err := store.CreateBucket(ctx, userID, boards[0].ID, CreateBucketInput{Name: fmt.Sprintf("List %d", index)})
		return err
	})
	assertConcurrentResults(t, listResults, defaultMaxListsPerBoard, ErrListLimit)

	loaded, err := store.GetBoard(ctx, userID, boards[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Buckets) != defaultMaxListsPerBoard {
		t.Fatalf("lists = %d, want %d", len(loaded.Buckets), defaultMaxListsPerBoard)
	}

	taskResults := runConcurrently(30, func(index int) error {
		_, err := store.CreateTask(ctx, userID, loaded.Buckets[0].ID, CreateTaskInput{Title: fmt.Sprintf("Task %d", index), OverrideLimit: true})
		return err
	})
	assertConcurrentResults(t, taskResults, defaultMaxTasksPerList, ErrActiveItemLimit)
}

func TestProHardActiveItemMaximumCoversCreateRetryMoveAndCompletion(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	tooHigh := defaultMaxTasksPerList + 1
	if _, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Invalid", MaxTasksPerList: tooHigh}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("create board above Pro maximum error = %v, want ErrInvalidData", err)
	}
	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Limits", MaxTasksPerList: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateBoard(ctx, userID, board.ID, UpdateBoardInput{MaxTasksPerList: &tooHigh}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("update board above Pro maximum error = %v, want ErrInvalidData", err)
	}
	target, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Target"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Source"})
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.CreateTask(ctx, userID, target.ID, CreateTaskInput{Title: "First"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateTask(ctx, userID, target.ID, CreateTaskInput{Title: "Working limit"}); !errors.Is(err, ErrLimitFull) {
		t.Fatalf("configured max active items error = %v, want ErrLimitFull", err)
	}
	if _, err := store.CreateTask(ctx, userID, target.ID, CreateTaskInput{Title: "Override 2", OverrideLimit: true}); err != nil {
		t.Fatalf("override lower working limit: %v", err)
	}
	hardMaximum := defaultMaxTasksPerList
	if _, err := store.UpdateBoard(ctx, userID, board.ID, UpdateBoardInput{MaxTasksPerList: &hardMaximum}); err != nil {
		t.Fatal(err)
	}
	for index := 3; index < defaultMaxTasksPerList; index++ {
		if _, err := store.CreateTask(ctx, userID, target.ID, CreateTaskInput{Title: fmt.Sprintf("Override %d", index), OverrideLimit: true}); err != nil {
			t.Fatalf("override create %d: %v", index, err)
		}
	}
	idempotent := CreateTaskInput{Title: "Idempotent twentieth", OverrideLimit: true, IdempotencyKey: "twentieth"}
	twentieth, err := store.CreateTask(ctx, userID, target.ID, idempotent)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := store.CreateTask(ctx, userID, target.ID, idempotent)
	if err != nil || retry.ID != twentieth.ID {
		t.Fatalf("idempotent retry = %#v, %v", retry, err)
	}
	if _, err := store.CreateTask(ctx, userID, target.ID, CreateTaskInput{Title: "Twenty first", OverrideLimit: true}); !errors.Is(err, ErrActiveItemLimit) {
		t.Fatalf("twenty-first create error = %v, want ErrActiveItemLimit", err)
	}
	moving, err := store.CreateTask(ctx, userID, source.ID, CreateTaskInput{Title: "Move me"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateTask(ctx, userID, moving.ID, UpdateTaskInput{BucketID: &target.ID}); !errors.Is(err, ErrActiveItemLimit) {
		t.Fatalf("API move into full list error = %v, want ErrActiveItemLimit", err)
	}
	if _, err := store.UpdateTaskForHuman(ctx, userID, moving.ID, UpdateTaskInput{BucketID: &target.ID}); !errors.Is(err, ErrActiveItemLimit) {
		t.Fatalf("human move into full list error = %v, want ErrActiveItemLimit", err)
	}
	done := true
	if _, err := store.UpdateTask(ctx, userID, first.ID, UpdateTaskInput{Done: &done}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateTask(ctx, userID, moving.ID, UpdateTaskInput{BucketID: &target.ID}); err != nil {
		t.Fatalf("move after completion freed capacity: %v", err)
	}
}

func TestProLimitLocksPreserveAccountOwnershipIsolation(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	ownerID := createIntegrationUser(t, ctx, db)
	otherID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id IN ($1, $2)", ownerID, otherID)
	})

	ownerBoard, err := store.CreateBoard(ctx, ownerID, CreateBoardInput{Name: "Owner"})
	if err != nil {
		t.Fatal(err)
	}
	ownerList, err := store.CreateBucket(ctx, ownerID, ownerBoard.ID, CreateBucketInput{Name: "Private"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateBucket(ctx, otherID, ownerBoard.ID, CreateBucketInput{Name: "Intruder"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-account list create error = %v, want ErrNotFound", err)
	}
	if _, err := store.CreateTask(ctx, otherID, ownerList.ID, CreateTaskInput{Title: "Intruder"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-account task create error = %v, want ErrNotFound", err)
	}

	otherBoard, err := store.CreateBoard(ctx, otherID, CreateBoardInput{Name: "Other"})
	if err != nil {
		t.Fatal(err)
	}
	otherList, err := store.CreateBucket(ctx, otherID, otherBoard.ID, CreateBucketInput{Name: "Other list"})
	if err != nil {
		t.Fatal(err)
	}
	otherTask, err := store.CreateTask(ctx, otherID, otherList.ID, CreateTaskInput{Title: "Other task"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateTask(ctx, otherID, otherTask.ID, UpdateTaskInput{BucketID: &ownerList.ID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-account move error = %v, want ErrNotFound", err)
	}
	unchanged, err := store.GetTask(ctx, otherID, otherTask.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.BucketID != otherList.ID {
		t.Fatalf("task moved to %q, want %q", unchanged.BucketID, otherList.ID)
	}
}

func runConcurrently(count int, operation func(int) error) []error {
	start := make(chan struct{})
	results := make([]error, count)
	var wait sync.WaitGroup
	wait.Add(count)
	for index := range results {
		go func() {
			defer wait.Done()
			<-start
			results[index] = operation(index)
		}()
	}
	close(start)
	wait.Wait()
	return results
}

func assertConcurrentResults(t *testing.T, results []error, wantSuccess int, wantLimit error) {
	t.Helper()
	var successes int
	for _, err := range results {
		if err == nil {
			successes++
			continue
		}
		if !errors.Is(err, wantLimit) {
			t.Fatalf("concurrent error = %v, want %v", err, wantLimit)
		}
	}
	if successes != wantSuccess {
		t.Fatalf("concurrent successes = %d, want %d", successes, wantSuccess)
	}
}

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

func TestTaskCreationIsIdempotentWithinAList(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Agent work"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Ready"})
	if err != nil {
		t.Fatal(err)
	}
	input := CreateTaskInput{Title: "Publish release", IdempotencyKey: "publish-release-v1"}
	first, err := store.CreateTask(ctx, userID, bucket.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.CreateTask(ctx, userID, bucket.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("retry created %q, want original %q", second.ID, first.ID)
	}
	otherBucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Working"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateTask(ctx, userID, first.ID, UpdateTaskInput{BucketID: &otherBucket.ID}); err != nil {
		t.Fatal(err)
	}
	afterMove, err := store.CreateTask(ctx, userID, bucket.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if afterMove.ID != first.ID || afterMove.BucketID != otherBucket.ID {
		t.Fatalf("retry after move = %#v, want moved original %q", afterMove, first.ID)
	}
	changedInput := input
	changedInput.Title = "Publish a different release"
	if _, err := store.CreateTask(ctx, userID, bucket.ID, changedInput); !errors.Is(err, ErrIdempotencyKey) {
		t.Fatalf("changed retry error = %v, want ErrIdempotencyKey", err)
	}
	tasks, err := store.ListTasks(ctx, userID, TaskFilter{BucketID: bucket.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 0 {
		t.Fatalf("original list tasks = %#v, want moved task only", tasks)
	}
	if err := store.DeleteTask(ctx, userID, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateTask(ctx, userID, bucket.ID, input); !errors.Is(err, ErrIdempotencyGone) {
		t.Fatalf("retry after delete error = %v, want ErrIdempotencyGone", err)
	}
}

func TestUpdateBucketCanSetAndClearInbox(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Inbox settings"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Capture"})
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []bool{true, false} {
		updated, err := store.UpdateBucket(ctx, userID, bucket.ID, UpdateBucketInput{IsInbox: &value})
		if err != nil {
			t.Fatal(err)
		}
		if updated.IsInbox != value {
			t.Fatalf("isInbox = %v, want %v", updated.IsInbox, value)
		}
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
