package boards

import (
	"context"
	"testing"
	"time"
)

func TestWorkspaceSummaryCountsAccountWork(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	ownerID := createIntegrationUser(t, ctx, db)
	otherID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id IN ($1, $2)", ownerID, otherID)
	})

	ownerList, err := store.CreateBucket(ctx, ownerID, CreateBucketInput{Name: "Owner work"})
	if err != nil {
		t.Fatal(err)
	}
	otherList, err := store.CreateBucket(ctx, otherID, CreateBucketInput{Name: "Other work"})
	if err != nil {
		t.Fatal(err)
	}
	var agentID string
	if err := db.QueryRow(ctx, `
		INSERT INTO agents (owner_user_id, name)
		VALUES ($1, 'Summary runner')
		RETURNING id::text
	`, ownerID).Scan(&agentID); err != nil {
		t.Fatal(err)
	}

	create := func(title string, status string) Task {
		t.Helper()
		task, err := store.CreateTask(ctx, ownerID, ownerList.ID, CreateTaskInput{Title: title, Kind: KindAction})
		if err != nil {
			t.Fatal(err)
		}
		if status != StatusNew {
			updated, err := store.UpdateTaskForHuman(ctx, ownerID, task.ID, UpdateTaskInput{Status: &status})
			if err != nil {
				t.Fatal(err)
			}
			task = updated
		}
		return task
	}

	create("New", StatusNew)
	create("Queued", StatusQueued)
	create("Working", StatusWorking)
	create("Review", StatusNeedsReview)
	create("Recently completed", StatusDone)
	oldDone := create("Old completed", StatusDone)

	parent := create("Parent", StatusNew)
	child, err := store.CreateSubtask(ctx, ownerID, parent.ID, CreateTaskInput{Title: "Child", Kind: KindAction})
	if err != nil {
		t.Fatal(err)
	}
	childWorking := StatusWorking
	if _, err := store.UpdateTaskForHuman(ctx, ownerID, child.ID, UpdateTaskInput{Status: &childWorking}); err != nil {
		t.Fatal(err)
	}

	managedTask, err := store.CreateTask(ctx, ownerID, ownerList.ID, CreateTaskInput{Title: "Repeated managed work", Kind: KindAction, AssigneeAgentID: agentID})
	if err != nil {
		t.Fatal(err)
	}
	recentRunIDs := []string{
		"10000000-0000-4000-8000-000000000001",
		"10000000-0000-4000-8000-000000000002",
	}
	if _, err := store.ClaimTaskForManagedRun(ctx, ownerID, agentID, managedTask.ID, recentRunIDs[0]); err != nil {
		t.Fatal(err)
	}
	queued := StatusQueued
	if _, err := store.UpdateTaskForHuman(ctx, ownerID, managedTask.ID, UpdateTaskInput{Status: &queued}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimTaskForManagedRun(ctx, ownerID, agentID, managedTask.ID, recentRunIDs[1]); err != nil {
		t.Fatal(err)
	}

	oldManagedTask, err := store.CreateTask(ctx, ownerID, ownerList.ID, CreateTaskInput{Title: "Old managed work", Kind: KindAction, AssigneeAgentID: agentID})
	if err != nil {
		t.Fatal(err)
	}
	oldRunID := "10000000-0000-4000-8000-000000000003"
	if _, err := store.ClaimTaskForManagedRun(ctx, ownerID, agentID, oldManagedTask.ID, oldRunID); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-25 * time.Hour)
	if _, err := db.Exec(ctx, "UPDATE task_run_starts SET started_at = $2 WHERE owner_user_id = $1 AND run_id = $3", ownerID, oldTime, oldRunID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "UPDATE tasks SET completed_at = $2 WHERE id = $1", oldDone.ID, oldTime); err != nil {
		t.Fatal(err)
	}
	oldDoneTitle := "Old completed, edited today"
	if _, err := store.UpdateTaskForHuman(ctx, ownerID, oldDone.ID, UpdateTaskInput{Title: &oldDoneTitle}); err != nil {
		t.Fatal(err)
	}
	oldRunTitle := "Old managed work, edited today"
	if _, err := store.UpdateTaskForHuman(ctx, ownerID, oldManagedTask.ID, UpdateTaskInput{Title: &oldRunTitle}); err != nil {
		t.Fatal(err)
	}
	otherTask, err := store.CreateTask(ctx, otherID, otherList.ID, CreateTaskInput{Title: "Other account", Kind: KindAction})
	if err != nil {
		t.Fatal(err)
	}
	otherWorking := StatusWorking
	if _, err := store.UpdateTaskForHuman(ctx, otherID, otherTask.ID, UpdateTaskInput{Status: &otherWorking}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "INSERT INTO task_run_starts (owner_user_id, run_id, task_id) VALUES ($1, $2, $3)", otherID, "10000000-0000-4000-8000-000000000004", otherTask.ID); err != nil {
		t.Fatal(err)
	}

	summary, err := store.WorkspaceSummary(ctx, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.ActiveTasks != 7 || summary.InProgress != 3 || summary.InReview != 1 || summary.Completed != 1 || summary.Runs != 2 {
		t.Fatalf("workspace summary = %#v, want active=7 inProgress=3 inReview=1 completed24h=1 runs24h=2", summary)
	}
}

func TestTaskActivityTimestampsSupportLegacyWriters(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	ownerID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", ownerID) })
	list, err := store.CreateBucket(ctx, ownerID, CreateBucketInput{Name: "Legacy writes"})
	if err != nil {
		t.Fatal(err)
	}

	legacyCompletion, err := store.CreateTask(ctx, ownerID, list.ID, CreateTaskInput{Title: "Legacy completion", Kind: KindAction})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "UPDATE tasks SET done = true, updated_at = now() WHERE id = $1", legacyCompletion.ID); err != nil {
		t.Fatal(err)
	}
	var status string
	var completedAt *time.Time
	if err := db.QueryRow(ctx, "SELECT status, completed_at FROM tasks WHERE id = $1", legacyCompletion.ID).Scan(&status, &completedAt); err != nil {
		t.Fatal(err)
	}
	if status != StatusDone || completedAt == nil {
		t.Fatalf("legacy completion status/timestamp = %q/%v", status, completedAt)
	}
	if _, err := db.Exec(ctx, "UPDATE tasks SET done = false, updated_at = now() WHERE id = $1", legacyCompletion.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, "SELECT status, completed_at FROM tasks WHERE id = $1", legacyCompletion.ID).Scan(&status, &completedAt); err != nil {
		t.Fatal(err)
	}
	if status == StatusDone || completedAt != nil {
		t.Fatalf("legacy reopening status/timestamp = %q/%v", status, completedAt)
	}

	var agentID string
	if err := db.QueryRow(ctx, "INSERT INTO agents (owner_user_id, name) VALUES ($1, 'Legacy runner') RETURNING id::text", ownerID).Scan(&agentID); err != nil {
		t.Fatal(err)
	}
	legacyRun, err := store.CreateTask(ctx, ownerID, list.ID, CreateTaskInput{Title: "Legacy run", Kind: KindAction, AssigneeAgentID: agentID})
	if err != nil {
		t.Fatal(err)
	}
	runID := "20000000-0000-4000-8000-000000000001"
	if _, err := db.Exec(ctx, "UPDATE tasks SET status = $2, execution_run_id = $3, updated_at = now() WHERE id = $1", legacyRun.ID, StatusWorking, runID); err != nil {
		t.Fatal(err)
	}
	var recorded int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM task_run_starts WHERE owner_user_id = $1 AND task_id = $2 AND run_id = $3", ownerID, legacyRun.ID, runID).Scan(&recorded); err != nil {
		t.Fatal(err)
	}
	if recorded != 1 {
		t.Fatalf("legacy managed run records = %d, want 1", recorded)
	}

	insertRunID := "20000000-0000-4000-8000-000000000002"
	var insertedTaskID string
	if err := db.QueryRow(ctx, `
		INSERT INTO tasks (bucket_id, title, execution_run_id)
		VALUES ($1, 'Task inserted with a run', $2)
		RETURNING id::text
	`, list.ID, insertRunID).Scan(&insertedTaskID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, "SELECT count(*) FROM task_run_starts WHERE owner_user_id = $1 AND task_id = $2 AND run_id = $3", ownerID, insertedTaskID, insertRunID).Scan(&recorded); err != nil {
		t.Fatal(err)
	}
	if recorded != 1 {
		t.Fatalf("inserted task run records = %d, want 1", recorded)
	}
}
