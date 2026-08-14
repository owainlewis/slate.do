package boards

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestManagedAgentRunClaimFencingOutputAndReplay(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	ownerID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", ownerID) })

	var agentID string
	if err := db.QueryRow(ctx, `
		INSERT INTO agents (owner_user_id, name, purpose)
		VALUES ($1, 'Managed Builder', 'Ships managed runs')
		RETURNING id::text
	`, ownerID).Scan(&agentID); err != nil {
		t.Fatal(err)
	}
	board, err := store.CreateBoard(ctx, ownerID, CreateBoardInput{Name: "Managed work"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, ownerID, board.ID, CreateBucketInput{Name: "Ready"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask(ctx, ownerID, bucket.ID, CreateTaskInput{Title: "Implement managed runs", AssigneeAgentID: agentID})
	if err != nil {
		t.Fatal(err)
	}
	legacyEntry, err := store.CreateCardEntry(ctx, ownerID, "", "Owner", task.ID, CreateCardEntryInput{Kind: "comment", Body: "Existing task context", IdempotencyKey: "existing-context"})
	if err != nil {
		t.Fatal(err)
	}

	runIDs := []string{
		"11111111-1111-4111-8111-111111111111",
		"22222222-2222-4222-8222-222222222222",
	}
	type claimResult struct {
		runID string
		err   error
	}
	results := make([]claimResult, len(runIDs))
	start := make(chan struct{})
	var claims sync.WaitGroup
	for index, runID := range runIDs {
		claims.Add(1)
		go func(index int, runID string) {
			defer claims.Done()
			<-start
			_, claimErr := store.ClaimTaskForManagedRun(ctx, ownerID, agentID, task.ID, runID)
			results[index] = claimResult{runID: runID, err: claimErr}
		}(index, runID)
	}
	close(start)
	claims.Wait()

	winner := ""
	loser := ""
	for _, result := range results {
		switch {
		case result.err == nil:
			if winner != "" {
				t.Fatalf("more than one managed claim succeeded: %#v", results)
			}
			winner = result.runID
		case errors.Is(result.err, ErrTaskUnavailable):
			loser = result.runID
		default:
			t.Fatalf("managed claim error = %v", result.err)
		}
	}
	if winner == "" || loser == "" {
		t.Fatalf("managed claim results = %#v", results)
	}
	var storedRunID, storedStatus string
	if err := db.QueryRow(ctx, `SELECT execution_run_id::text, status FROM tasks WHERE id = $1`, task.ID).Scan(&storedRunID, &storedStatus); err != nil {
		t.Fatal(err)
	}
	if storedRunID != winner || storedStatus != StatusWorking {
		t.Fatalf("stored managed claim = %q/%q, want %q/%q", storedRunID, storedStatus, winner, StatusWorking)
	}

	comment := CreateCardEntryInput{Kind: "comment", Body: "Implementation started", IdempotencyKey: "managed-comment", RunID: winner}
	if _, err := store.CreateCardEntry(ctx, ownerID, agentID, "", task.ID, CreateCardEntryInput{Kind: "comment", Body: "stale", IdempotencyKey: "stale-comment", RunID: loser}); !errors.Is(err, ErrManagedRunMismatch) {
		t.Fatalf("stale comment error = %v, want ErrManagedRunMismatch", err)
	}
	missingRun := comment
	missingRun.IdempotencyKey = "missing-run-comment"
	missingRun.RunID = ""
	if _, err := store.CreateCardEntry(ctx, ownerID, agentID, "", task.ID, missingRun); !errors.Is(err, ErrManagedRunMismatch) {
		t.Fatalf("missing run comment error = %v, want ErrManagedRunMismatch", err)
	}
	createdComment, err := store.CreateCardEntry(ctx, ownerID, agentID, "", task.ID, comment)
	if err != nil {
		t.Fatal(err)
	}
	if createdComment.RunID != winner || createdComment.CardStatus != StatusWorking {
		t.Fatalf("managed comment = %#v", createdComment)
	}

	outputInput := CreateCardEntryInput{Kind: "output", Body: "Implemented and tested", IdempotencyKey: "managed-output", RunID: winner}
	output, err := store.CreateCardEntry(ctx, ownerID, agentID, "", task.ID, outputInput)
	if err != nil {
		t.Fatal(err)
	}
	if output.RunID != winner || output.CardStatus != StatusNeedsReview || output.CardReviewReason != "output" {
		t.Fatalf("managed output = %#v", output)
	}
	entries, err := store.ListCardEntriesForRun(ctx, ownerID, agentID, task.ID, winner)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].ID != createdComment.ID || entries[1].ID != output.ID {
		t.Fatalf("managed entries = %#v", entries)
	}
	for _, entry := range entries {
		if entry.ID == legacyEntry.ID {
			t.Fatalf("exact run filter returned legacy entry: %#v", entry)
		}
		if entry.RunID != winner {
			t.Fatalf("entry run ID = %q, want %q", entry.RunID, winner)
		}
	}

	done := StatusDone
	if _, err := store.UpdateTaskForAgent(ctx, ownerID, agentID, task.ID, UpdateTaskInput{Status: &done, RunID: winner}); !errors.Is(err, ErrManagedRunStatusLocked) {
		t.Fatalf("managed direct status error = %v, want ErrManagedRunStatusLocked", err)
	}
	if _, err := store.UpdateTaskForHuman(ctx, ownerID, task.ID, UpdateTaskInput{Status: &done}); err != nil {
		t.Fatal(err)
	}
	replayed, err := store.CreateCardEntry(ctx, ownerID, agentID, "", task.ID, outputInput)
	if err != nil {
		t.Fatal(err)
	}
	if replayed.ID != output.ID || replayed.CardStatus != StatusNeedsReview || replayed.CardReviewReason != "output" {
		t.Fatalf("managed output replay = %#v", replayed)
	}
	newOutput := outputInput
	newOutput.IdempotencyKey = "managed-output-second"
	if _, err := store.CreateCardEntry(ctx, ownerID, agentID, "", task.ID, newOutput); !errors.Is(err, ErrTaskUnavailable) {
		t.Fatalf("new output after review error = %v, want ErrTaskUnavailable", err)
	}
	var outputCount int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM card_entries WHERE task_id = $1 AND kind = 'output'`, task.ID).Scan(&outputCount); err != nil {
		t.Fatal(err)
	}
	if outputCount != 1 {
		t.Fatalf("managed output count = %d, want 1", outputCount)
	}
	var replacementAgentID string
	if err := db.QueryRow(ctx, `
		INSERT INTO agents (owner_user_id, name)
		VALUES ($1, 'Replacement Builder')
		RETURNING id::text
	`, ownerID).Scan(&replacementAgentID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `UPDATE tasks SET assignee_agent_id = $1 WHERE id = $2`, replacementAgentID, task.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateCardEntry(ctx, ownerID, agentID, "", task.ID, outputInput); !errors.Is(err, ErrNotFound) {
		t.Fatalf("replay after reassignment error = %v, want ErrNotFound", err)
	}
	if _, err := db.Exec(ctx, `
		UPDATE tasks
		SET assignee_agent_id = $1, execution_run_id = $2, status = $3
		WHERE id = $4
	`, agentID, loser, StatusWorking, task.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateCardEntry(ctx, ownerID, agentID, "", task.ID, outputInput); !errors.Is(err, ErrManagedRunMismatch) {
		t.Fatalf("replay after newer run error = %v, want ErrManagedRunMismatch", err)
	}

	preclaim, err := store.CreateTask(ctx, ownerID, bucket.ID, CreateTaskInput{Title: "Not claimed", AssigneeAgentID: agentID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateCardEntry(ctx, ownerID, agentID, "", preclaim.ID, CreateCardEntryInput{Kind: "output", Body: "too early", IdempotencyKey: "preclaim-output", RunID: winner}); !errors.Is(err, ErrManagedRunMismatch) {
		t.Fatalf("preclaim output error = %v, want ErrManagedRunMismatch", err)
	}
	if _, err := store.ClaimTaskForAgent(ctx, ownerID, agentID, preclaim.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateTaskForAgent(ctx, ownerID, agentID, preclaim.ID, UpdateTaskInput{Status: &done}); err != nil {
		t.Fatalf("legacy agent status update: %v", err)
	}
}

func TestAgentQueueOrdersPriorityThenOldest(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	ownerID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", ownerID) })
	var agentID string
	if err := db.QueryRow(ctx, `INSERT INTO agents (owner_user_id, name) VALUES ($1, 'Queue Agent') RETURNING id::text`, ownerID).Scan(&agentID); err != nil {
		t.Fatal(err)
	}
	board, err := store.CreateBoard(ctx, ownerID, CreateBoardInput{Name: "Queue"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, ownerID, board.ID, CreateBucketInput{Name: "Ready"})
	if err != nil {
		t.Fatal(err)
	}
	type queuedTask struct {
		title    string
		priority string
		age      time.Duration
	}
	inputs := []queuedTask{
		{title: "P1", priority: PriorityP1, age: 4 * time.Hour},
		{title: "P0 new", priority: PriorityP0, age: time.Hour},
		{title: "No priority", priority: PriorityNone, age: 6 * time.Hour},
		{title: "P0 old", priority: PriorityP0, age: 5 * time.Hour},
		{title: "P2", priority: PriorityP2, age: 3 * time.Hour},
	}
	for _, input := range inputs {
		task, err := store.CreateTask(ctx, ownerID, bucket.ID, CreateTaskInput{Title: input.title, AssigneeAgentID: agentID})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(ctx, `UPDATE tasks SET priority = $1, created_at = $2 WHERE id = $3`, input.priority, time.Now().Add(-input.age), task.ID); err != nil {
			t.Fatal(err)
		}
	}
	page, err := store.ListTaskPage(ctx, ownerID, TaskFilter{Status: StatusQueued, AssigneeAgentID: agentID, ActionsOnly: true, AgentQueue: true})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"P0 old", "P0 new", "P1", "P2", "No priority"}
	if len(page.Tasks) != len(want) {
		t.Fatalf("queue length = %d, want %d", len(page.Tasks), len(want))
	}
	for index, title := range want {
		if page.Tasks[index].Title != title {
			t.Fatalf("queue[%d] = %q, want %q; queue = %s", index, page.Tasks[index].Title, title, fmt.Sprint(page.Tasks))
		}
	}
	filter := TaskFilter{Status: StatusQueued, AssigneeAgentID: agentID, ActionsOnly: true, AgentQueue: true, Limit: 2}
	var paged []string
	for pages := 0; pages < 10; pages++ {
		page, err := store.ListTaskPage(ctx, ownerID, filter)
		if err != nil {
			t.Fatal(err)
		}
		for _, task := range page.Tasks {
			paged = append(paged, task.Title)
		}
		if page.NextCursor == "" {
			break
		}
		filter.Cursor = page.NextCursor
	}
	if fmt.Sprint(paged) != fmt.Sprint(want) {
		t.Fatalf("paged queue = %v, want %v", paged, want)
	}
}
