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
	"github.com/owainlewis/slate.do/server/internal/entitlements"
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
	for index, err := range taskResults {
		if err != nil {
			t.Fatalf("concurrent task %d: %v", index, err)
		}
	}
}

func TestCardConversationKeepsHumanAndAssignedAgentOnOneRecord(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	ownerID := createIntegrationUser(t, ctx, db)
	otherID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id IN ($1, $2)", ownerID, otherID)
	})

	var agentID, siblingAgentID string
	if err := db.QueryRow(ctx, `INSERT INTO agents (owner_user_id, name) VALUES ($1, 'Builder') RETURNING id::text`, ownerID).Scan(&agentID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `INSERT INTO agents (owner_user_id, name) VALUES ($1, 'Sibling') RETURNING id::text`, ownerID).Scan(&siblingAgentID); err != nil {
		t.Fatal(err)
	}
	board, err := store.CreateBoard(ctx, ownerID, CreateBoardInput{Name: "Work"})
	if err != nil {
		t.Fatal(err)
	}
	list, err := store.CreateBucket(ctx, ownerID, board.ID, CreateBucketInput{Name: "Launch"})
	if err != nil {
		t.Fatal(err)
	}
	card, err := store.CreateTask(ctx, ownerID, list.ID, CreateTaskInput{Title: "Draft launch", AssigneeAgentID: agentID})
	if err != nil {
		t.Fatal(err)
	}
	commentInput := CreateCardEntryInput{Kind: "comment", Body: "Keep it concise", IdempotencyKey: "comment-attempt"}
	comment, err := store.CreateCardEntry(ctx, ownerID, "", "Owain", card.ID, commentInput)
	if err != nil {
		t.Fatal(err)
	}
	if comment.AuthorKind != "human" || comment.AuthorName != "Owain" {
		t.Fatalf("human comment author = %#v", comment)
	}
	retriedComment, err := store.CreateCardEntry(ctx, ownerID, "", "Owain", card.ID, commentInput)
	if err != nil {
		t.Fatal(err)
	}
	if retriedComment.ID != comment.ID {
		t.Fatalf("retried comment = %q, want %q", retriedComment.ID, comment.ID)
	}
	changedComment := commentInput
	changedComment.Body = "A different comment"
	if _, err := store.CreateCardEntry(ctx, ownerID, "", "Owain", card.ID, changedComment); !errors.Is(err, ErrIdempotencyKey) {
		t.Fatalf("changed comment retry error = %v, want ErrIdempotencyKey", err)
	}
	concurrentIDs := make([]string, 8)
	concurrentInput := CreateCardEntryInput{Kind: "comment", Body: "One concurrent comment", IdempotencyKey: "concurrent-comment"}
	concurrentResults := runConcurrently(len(concurrentIDs), func(index int) error {
		entry, err := store.CreateCardEntry(ctx, ownerID, "", "Owain", card.ID, concurrentInput)
		if err == nil {
			concurrentIDs[index] = entry.ID
		}
		return err
	})
	for index, err := range concurrentResults {
		if err != nil {
			t.Fatalf("concurrent comment %d: %v", index, err)
		}
		if concurrentIDs[index] != concurrentIDs[0] {
			t.Fatalf("concurrent comment %d = %q, want %q", index, concurrentIDs[index], concurrentIDs[0])
		}
	}
	outputInput := CreateCardEntryInput{Kind: "output", Body: "Draft is ready", IdempotencyKey: "output-attempt"}
	output, err := store.CreateCardEntry(ctx, ownerID, agentID, "", card.ID, outputInput)
	if err != nil {
		t.Fatal(err)
	}
	if output.AuthorKind != "agent" || output.AuthorName != "Builder" || output.CardStatus != StatusNeedsReview || output.CardReviewReason != "output" {
		t.Fatalf("agent output author = %#v", output)
	}
	entries, err := store.ListCardEntries(ctx, ownerID, agentID, card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 || entries[0].ID != comment.ID || entries[1].ID != concurrentIDs[0] || entries[2].ID != output.ID {
		t.Fatalf("entries = %#v", entries)
	}
	updated, err := store.GetTask(ctx, ownerID, card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != StatusNeedsReview {
		t.Fatalf("card status = %q", updated.Status)
	}
	needsReview := StatusNeedsReview
	reviewKinds, err := store.ListCardReviewKinds(ctx, ownerID, "")
	if err != nil {
		t.Fatal(err)
	}
	if reviewKinds[card.ID] != "output" {
		t.Fatalf("review kind = %q, want output", reviewKinds[card.ID])
	}
	renamed := "Card edited while reviewing output"
	if _, err := store.UpdateTask(ctx, ownerID, card.ID, UpdateTaskInput{Title: &renamed}); err != nil {
		t.Fatal(err)
	}
	card.Title = renamed
	reviewKinds, err = store.ListCardReviewKinds(ctx, ownerID, "")
	if err != nil {
		t.Fatal(err)
	}
	if reviewKinds[card.ID] != "output" {
		t.Fatalf("review kind after edit = %q, want output", reviewKinds[card.ID])
	}
	queued := StatusQueued
	if _, err := store.UpdateTask(ctx, ownerID, card.ID, UpdateTaskInput{Status: &queued}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateTask(ctx, ownerID, card.ID, UpdateTaskInput{Status: &needsReview}); err != nil {
		t.Fatal(err)
	}
	reviewKinds, err = store.ListCardReviewKinds(ctx, ownerID, "")
	if err != nil {
		t.Fatal(err)
	}
	if reviewKinds[card.ID] != "other" {
		t.Fatalf("review kind after manual re-entry = %q, want other", reviewKinds[card.ID])
	}
	done := StatusDone
	if _, err := store.UpdateTask(ctx, ownerID, card.ID, UpdateTaskInput{Status: &done}); err != nil {
		t.Fatal(err)
	}
	replayedOutput, err := store.CreateCardEntry(ctx, ownerID, agentID, "", card.ID, outputInput)
	if err != nil {
		t.Fatal(err)
	}
	if replayedOutput.ID != output.ID || replayedOutput.CardStatus != StatusDone || replayedOutput.CardReviewReason != "" {
		t.Fatalf("replayed output = %#v", replayedOutput)
	}
	updated, err = store.GetTask(ctx, ownerID, card.ID)
	if err != nil || updated.Status != StatusDone {
		t.Fatalf("card after output replay = %#v, error = %v", updated, err)
	}
	if _, err := store.ListCardEntries(ctx, ownerID, siblingAgentID, card.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("sibling agent list error = %v, want ErrNotFound", err)
	}
	if _, err := store.ListCardEntries(ctx, otherID, "", card.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other owner list error = %v, want ErrNotFound", err)
	}
	assertStorageUsage(t, ctx, db, ownerID, 1, taskContentBytes(card)+int64(len(comment.Body)+len(concurrentInput.Body)+len(output.Body)))
	if err := store.DeleteTask(ctx, ownerID, card.ID); err != nil {
		t.Fatal(err)
	}
	assertStorageUsage(t, ctx, db, ownerID, 0, 0)
}

func TestFreeAccountUsesCatalogBoardAndListLimits(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	userID := createFreeIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })
	store := NewStore(db)

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Free board"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Second board"}); !errors.Is(err, ErrBoardLimit) {
		t.Fatalf("second free board error = %v", err)
	}
	for index := 0; index < entitlements.FreeLimits.ListsPerBoard; index++ {
		if _, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: fmt.Sprintf("List %d", index+1)}); err != nil {
			t.Fatalf("create free list %d: %v", index+1, err)
		}
	}
	if _, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "One too many"}); !errors.Is(err, ErrListLimit) {
		t.Fatalf("sixth free list error = %v", err)
	}
}

func TestAgentAssignmentsAreAccountScopedAndSurviveArchive(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	ownerID := createIntegrationUser(t, ctx, db)
	otherID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id IN ($1, $2)", ownerID, otherID)
	})

	var ownerAgentID, otherAgentID string
	if err := db.QueryRow(ctx, `
		INSERT INTO agents (owner_user_id, name)
		VALUES ($1, 'Owner agent')
		RETURNING id::text
	`, ownerID).Scan(&ownerAgentID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `
		INSERT INTO agents (owner_user_id, name)
		VALUES ($1, 'Other agent')
		RETURNING id::text
	`, otherID).Scan(&otherAgentID); err != nil {
		t.Fatal(err)
	}
	var siblingAgentID string
	if err := db.QueryRow(ctx, `
		INSERT INTO agents (owner_user_id, name)
		VALUES ($1, 'Sibling agent')
		RETURNING id::text
	`, ownerID).Scan(&siblingAgentID); err != nil {
		t.Fatal(err)
	}

	board, err := store.CreateBoard(ctx, ownerID, CreateBoardInput{Name: "Agent work"})
	if err != nil {
		t.Fatal(err)
	}
	list, err := store.CreateBucket(ctx, ownerID, board.ID, CreateBucketInput{Name: "Queue"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask(ctx, ownerID, list.ID, CreateTaskInput{Title: "Assigned", AssigneeAgentID: ownerAgentID})
	if err != nil {
		t.Fatal(err)
	}
	if task.AssigneeAgentID != ownerAgentID {
		t.Fatalf("assignee = %q, want %q", task.AssigneeAgentID, ownerAgentID)
	}
	if task.Status != StatusQueued {
		t.Fatalf("assigned task status = %q, want %q", task.Status, StatusQueued)
	}
	if _, err := store.CreateTask(ctx, ownerID, list.ID, CreateTaskInput{Title: "Malformed", AssigneeAgentID: "not-a-uuid"}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("malformed create assignment error = %v", err)
	}
	if _, err := store.CreateTask(ctx, ownerID, list.ID, CreateTaskInput{Title: "Cross account", AssigneeAgentID: otherAgentID}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("cross-account assignment error = %v", err)
	}
	malformed := "not-a-uuid"
	if _, err := store.UpdateTask(ctx, ownerID, task.ID, UpdateTaskInput{AssigneeAgentID: &malformed}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("malformed update assignment error = %v", err)
	}
	tasks, err := store.ListTasks(ctx, ownerID, TaskFilter{AssigneeAgentID: ownerAgentID})
	if err != nil || len(tasks) != 1 || tasks[0].ID != task.ID {
		t.Fatalf("assigned queue = %#v, error = %v", tasks, err)
	}
	captured, err := store.CreateTask(ctx, ownerID, list.ID, CreateTaskInput{Title: "Captured first"})
	if err != nil {
		t.Fatal(err)
	}
	assignedCaptured, err := store.UpdateTaskForHuman(ctx, ownerID, captured.ID, UpdateTaskInput{AssigneeAgentID: &ownerAgentID})
	if err != nil {
		t.Fatal(err)
	}
	if assignedCaptured.Status != StatusQueued {
		t.Fatalf("newly assigned captured task status = %q, want %q", assignedCaptured.Status, StatusQueued)
	}
	ready := StatusQueued
	if _, err := store.UpdateTaskForHuman(ctx, ownerID, task.ID, UpdateTaskInput{Status: &ready}); err != nil {
		t.Fatalf("mark assigned card ready: %v", err)
	}
	if _, err := store.ClaimTaskForAgent(ctx, ownerID, otherAgentID, task.ID); !errors.Is(err, ErrTaskUnavailable) {
		t.Fatalf("other agent claim error = %v", err)
	}
	if _, err := store.ClaimTaskForAgent(ctx, ownerID, siblingAgentID, task.ID); !errors.Is(err, ErrTaskUnavailable) {
		t.Fatalf("same-account sibling agent claim error = %v", err)
	}
	if _, err := store.ClaimTaskForAgent(ctx, ownerID, ownerAgentID, task.ID); err != nil {
		t.Fatalf("assigned agent claim: %v", err)
	}

	if _, err := db.Exec(ctx, "UPDATE agents SET archived_at = now() WHERE id = $1", ownerAgentID); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.GetTask(ctx, ownerID, task.ID)
	if err != nil || loaded.AssigneeAgentID != ownerAgentID {
		t.Fatalf("assignment after soft delete = %#v, error = %v", loaded, err)
	}
	if _, err := store.UpdateTask(ctx, ownerID, task.ID, UpdateTaskInput{AssigneeAgentID: &ownerAgentID}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("deleted agent reassignment error = %v", err)
	}
}

func TestWorkspaceListsInboxFiltersAndOneLevelSubtasks(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Workspace"})
	if err != nil {
		t.Fatal(err)
	}
	inbox, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Inbox", IsInbox: true})
	if err != nil {
		t.Fatal(err)
	}
	content, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "YouTube", Goal: "Plan useful videos"})
	if err != nil {
		t.Fatal(err)
	}
	resolvedInboxID, err := store.InboxBucketID(ctx, userID)
	if err != nil || resolvedInboxID != inbox.ID {
		t.Fatalf("resolved inbox = %q, %v; want %q", resolvedInboxID, err, inbox.ID)
	}

	parent, err := store.CreateTask(ctx, userID, content.ID, CreateTaskInput{
		Title: "Publish task-first agents video", Description: "Explain the control plane", ScheduledDate: "2026-08-12",
	})
	if err != nil {
		t.Fatal(err)
	}
	child, err := store.CreateSubtask(ctx, userID, parent.ID, CreateTaskInput{Title: "Research examples"})
	if err != nil {
		t.Fatal(err)
	}
	if child.ParentTaskID != parent.ID || child.BucketID != content.ID {
		t.Fatalf("subtask = %#v", child)
	}
	childDate := "2026-08-13"
	childStatus := StatusNeedsReview
	child, err = store.UpdateTaskForHuman(ctx, userID, child.ID, UpdateTaskInput{ScheduledDate: &childDate, Status: &childStatus})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSubtask(ctx, userID, child.ID, CreateTaskInput{Title: "Nested"}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("nested subtask error = %v, want ErrInvalidData", err)
	}

	topLevel, err := store.ListTaskPage(ctx, userID, TaskFilter{TopLevelOnly: true, Query: "task-first"})
	if err != nil || len(topLevel.Tasks) != 1 || topLevel.Tasks[0].ID != parent.ID {
		t.Fatalf("top-level search = %#v, %v", topLevel, err)
	}
	children, err := store.ListTaskPage(ctx, userID, TaskFilter{ParentTaskID: parent.ID})
	if err != nil || len(children.Tasks) != 1 || children.Tasks[0].ID != child.ID {
		t.Fatalf("children = %#v, %v", children, err)
	}
	globalSearch, err := store.ListTaskPage(ctx, userID, TaskFilter{Query: "Research examples"})
	if err != nil || len(globalSearch.Tasks) != 1 || globalSearch.Tasks[0].ID != child.ID || globalSearch.Tasks[0].ParentTaskTitle != parent.Title {
		t.Fatalf("global subtask search = %#v, %v", globalSearch, err)
	}
	otherUserID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", otherUserID) })
	otherBoard, err := store.CreateBoard(ctx, otherUserID, CreateBoardInput{Name: "Private workspace"})
	if err != nil {
		t.Fatal(err)
	}
	otherList, err := store.CreateBucket(ctx, otherUserID, otherBoard.ID, CreateBucketInput{Name: "Private list"})
	if err != nil {
		t.Fatal(err)
	}
	foreignParent, err := store.CreateTask(ctx, otherUserID, otherList.ID, CreateTaskInput{Title: "Secret parent title"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "UPDATE tasks SET parent_task_id = $2 WHERE id = $1", child.ID, foreignParent.ID); err != nil {
		t.Fatal(err)
	}
	malformedCrossAccount, err := store.ListTaskPage(ctx, userID, TaskFilter{Query: "Research examples"})
	if err != nil || len(malformedCrossAccount.Tasks) != 1 || malformedCrossAccount.Tasks[0].ParentTaskTitle != "" {
		t.Fatalf("cross-account parent title = %#v, %v", malformedCrossAccount, err)
	}
	if _, err := db.Exec(ctx, "UPDATE tasks SET parent_task_id = $2 WHERE id = $1", child.ID, parent.ID); err != nil {
		t.Fatal(err)
	}
	plannedSubtasks, err := store.ListTaskPage(ctx, userID, TaskFilter{ScheduledFrom: childDate, ScheduledTo: childDate})
	if err != nil || len(plannedSubtasks.Tasks) != 1 || plannedSubtasks.Tasks[0].ID != child.ID {
		t.Fatalf("planned subtasks = %#v, %v", plannedSubtasks, err)
	}
	reviewSubtasks, err := store.ListTaskPage(ctx, userID, TaskFilter{Status: StatusNeedsReview})
	if err != nil || len(reviewSubtasks.Tasks) != 1 || reviewSubtasks.Tasks[0].ID != child.ID {
		t.Fatalf("review subtasks = %#v, %v", reviewSubtasks, err)
	}
	topLevelPlanned, err := store.ListTaskPage(ctx, userID, TaskFilter{TopLevelOnly: true, ScheduledFrom: childDate, ScheduledTo: childDate})
	if err != nil || len(topLevelPlanned.Tasks) != 0 {
		t.Fatalf("top-level planned tasks = %#v, %v", topLevelPlanned, err)
	}
	lists, err := store.ListAllBuckets(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if len(lists) != 2 || lists[0].BoardName != board.Name || lists[1].BoardName != board.Name {
		t.Fatalf("workspace lists = %#v", lists)
	}

	if err := store.DeleteTask(ctx, userID, parent.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetTask(ctx, userID, child.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("child after parent deletion error = %v, want ErrNotFound", err)
	}
	assertStorageUsage(t, ctx, db, userID, 0, 0)
}

func TestTaskSearchTreatsPatternCharactersAsLiteralText(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Search"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Cards"})
	if err != nil {
		t.Fatal(err)
	}
	inputs := []CreateTaskInput{
		{Title: "100% coverage"},
		{Title: "100 percent coverage"},
		{Title: "Plan_A"},
		{Title: "PlanBA"},
		{Title: `Path \ docs`},
		{Title: "Path docs"},
		{Title: "Metrics", Description: "Uses a 50% threshold"},
		{Title: "Other metrics", Description: "Uses a 50 percent threshold"},
	}
	created := make([]Task, 0, len(inputs))
	for _, input := range inputs {
		task, err := store.CreateTask(ctx, userID, bucket.ID, input)
		if err != nil {
			t.Fatal(err)
		}
		created = append(created, task)
	}

	assertSearch := func(query string, want Task) {
		t.Helper()
		page, err := store.ListTaskPage(ctx, userID, TaskFilter{Query: query})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Tasks) != 1 || page.Tasks[0].ID != want.ID {
			t.Fatalf("query %q tasks = %#v, want only %q", query, page.Tasks, want.ID)
		}
	}
	assertSearch("100% COVERAGE", created[0])
	assertSearch("Plan_A", created[2])
	assertSearch(`\`, created[4])
	assertSearch("50% threshold", created[6])
}

func TestAccountAlwaysKeepsAnInboxForUniversalCapture(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	firstBoard, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "First"})
	if err != nil {
		t.Fatal(err)
	}
	firstInbox, err := store.CreateBucket(ctx, userID, firstBoard.ID, CreateBucketInput{Name: "Inbox", IsInbox: true})
	if err != nil {
		t.Fatal(err)
	}
	falseValue := false
	if _, err := store.UpdateBucket(ctx, userID, firstInbox.ID, UpdateBucketInput{IsInbox: &falseValue}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("remove final Inbox marker error = %v, want ErrInvalidData", err)
	}
	if err := store.DeleteBucket(ctx, userID, firstInbox.ID); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("delete final Inbox error = %v, want ErrInvalidData", err)
	}
	if err := store.DeleteBoard(ctx, userID, firstBoard.ID); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("delete board containing final Inbox error = %v, want ErrInvalidData", err)
	}

	secondBoard, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Second"})
	if err != nil {
		t.Fatal(err)
	}
	secondInbox, err := store.CreateBucket(ctx, userID, secondBoard.ID, CreateBucketInput{Name: "Inbox", IsInbox: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteBucket(ctx, userID, firstInbox.ID); err != nil {
		t.Fatalf("delete Inbox with replacement: %v", err)
	}
	resolved, err := store.InboxBucketID(ctx, userID)
	if err != nil || resolved != secondInbox.ID {
		t.Fatalf("replacement Inbox = %q, %v; want %q", resolved, err, secondInbox.ID)
	}
	if _, err := store.CreateTask(ctx, userID, resolved, CreateTaskInput{Title: "Captured after replacement"}); err != nil {
		t.Fatalf("capture after Inbox replacement: %v", err)
	}
}

func TestEnsureInboxBucketIDRepairsEveryEmptyAccountState(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)

	t.Run("no boards", func(t *testing.T) {
		userID := createIntegrationUser(t, ctx, db)
		t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

		inboxID, err := store.EnsureInboxBucketID(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		inbox, err := store.GetBucket(ctx, userID, inboxID)
		if err != nil {
			t.Fatal(err)
		}
		boards, err := store.ListBoards(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		if len(boards) != 1 || inbox.BoardID != boards[0].ID || !inbox.IsInbox || inbox.Name != "Inbox" {
			t.Fatalf("boards = %#v, inbox = %#v", boards, inbox)
		}
		if _, err := store.CreateTask(ctx, userID, inboxID, CreateTaskInput{Title: "First captured task"}); err != nil {
			t.Fatalf("capture after repair: %v", err)
		}
	})

	t.Run("board without lists", func(t *testing.T) {
		userID := createIntegrationUser(t, ctx, db)
		t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })
		board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Existing board"})
		if err != nil {
			t.Fatal(err)
		}

		inboxID, err := store.EnsureInboxBucketID(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		inbox, err := store.GetBucket(ctx, userID, inboxID)
		if err != nil {
			t.Fatal(err)
		}
		lists, err := store.ListAllBuckets(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		if len(lists) != 1 || inbox.BoardID != board.ID || !inbox.IsInbox {
			t.Fatalf("lists = %#v, inbox = %#v", lists, inbox)
		}
	})

	t.Run("existing list without Inbox", func(t *testing.T) {
		userID := createIntegrationUser(t, ctx, db)
		t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })
		board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Existing board"})
		if err != nil {
			t.Fatal(err)
		}
		list, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Ideas"})
		if err != nil {
			t.Fatal(err)
		}

		inboxID, err := store.EnsureInboxBucketID(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		promoted, err := store.GetBucket(ctx, userID, inboxID)
		if err != nil {
			t.Fatal(err)
		}
		lists, err := store.ListAllBuckets(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		if inboxID != list.ID || len(lists) != 1 || !promoted.IsInbox {
			t.Fatalf("promoted = %#v, lists = %#v", promoted, lists)
		}
	})

	t.Run("existing Inbox is stable", func(t *testing.T) {
		userID := createIntegrationUser(t, ctx, db)
		t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })
		board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Existing board"})
		if err != nil {
			t.Fatal(err)
		}
		inbox, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Capture", IsInbox: true})
		if err != nil {
			t.Fatal(err)
		}

		first, err := store.EnsureInboxBucketID(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		second, err := store.EnsureInboxBucketID(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		lists, err := store.ListAllBuckets(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		if first != inbox.ID || second != inbox.ID || len(lists) != 1 {
			t.Fatalf("first = %q, second = %q, lists = %#v", first, second, lists)
		}
	})

	t.Run("concurrent first capture creates one Inbox", func(t *testing.T) {
		userID := createIntegrationUser(t, ctx, db)
		t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })
		var mu sync.Mutex
		var inboxIDs []string
		results := runConcurrently(8, func(_ int) error {
			inboxID, err := store.EnsureInboxBucketID(ctx, userID)
			if err == nil {
				mu.Lock()
				inboxIDs = append(inboxIDs, inboxID)
				mu.Unlock()
			}
			return err
		})
		assertConcurrentResults(t, results, len(results), nil)
		boards, err := store.ListBoards(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		lists, err := store.ListAllBuckets(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		if len(boards) != 1 || len(lists) != 1 || len(inboxIDs) != len(results) {
			t.Fatalf("boards = %#v, lists = %#v, inbox IDs = %#v", boards, lists, inboxIDs)
		}
		for _, inboxID := range inboxIDs {
			if inboxID != lists[0].ID {
				t.Fatalf("inbox ID = %q, want %q", inboxID, lists[0].ID)
			}
		}
	})
}

func TestLegacyActiveItemConfigurationDoesNotBlockCreateRetryOrMove(t *testing.T) {
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
	_, err = store.CreateTask(ctx, userID, target.ID, CreateTaskInput{Title: "First"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateTask(ctx, userID, target.ID, CreateTaskInput{Title: "Past configured limit"}); err != nil {
		t.Fatalf("create past configured limit: %v", err)
	}
	if _, err := store.CreateTask(ctx, userID, target.ID, CreateTaskInput{Title: "Override 2", OverrideLimit: true}); err != nil {
		t.Fatalf("deprecated override remains compatible: %v", err)
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
	if _, err := store.CreateTask(ctx, userID, target.ID, CreateTaskInput{Title: "Twenty first", OverrideLimit: true}); err != nil {
		t.Fatalf("twenty-first create: %v", err)
	}
	moving, err := store.CreateTask(ctx, userID, source.ID, CreateTaskInput{Title: "Move me"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateTask(ctx, userID, moving.ID, UpdateTaskInput{BucketID: &target.ID}); err != nil {
		t.Fatalf("API move into populated list: %v", err)
	}
	if _, err := store.UpdateTask(ctx, userID, moving.ID, UpdateTaskInput{BucketID: &target.ID}); err != nil {
		t.Fatalf("repeated same-list move: %v", err)
	}
}

func TestMoveTaskAcrossBoardsPreservesMetadataAndOrdersBothLists(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	sourceBoard, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Source"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateBucket(ctx, userID, sourceBoard.ID, CreateBucketInput{Name: "Ideas"})
	if err != nil {
		t.Fatal(err)
	}
	destinationBoard, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Destination"})
	if err != nil {
		t.Fatal(err)
	}
	destination, err := store.CreateBucket(ctx, userID, destinationBoard.ID, CreateBucketInput{Name: "Ready"})
	if err != nil {
		t.Fatal(err)
	}

	before, err := store.CreateTask(ctx, userID, source.ID, CreateTaskInput{Title: "Before"})
	if err != nil {
		t.Fatal(err)
	}
	moving, err := store.CreateTask(ctx, userID, source.ID, CreateTaskInput{
		Title: "Move me", Description: "Keep this context", ScheduledDate: "2026-07-25",
	})
	if err != nil {
		t.Fatal(err)
	}
	firstChild, err := store.CreateSubtask(ctx, userID, moving.ID, CreateTaskInput{Title: "First child"})
	if err != nil {
		t.Fatal(err)
	}
	secondChild, err := store.CreateSubtask(ctx, userID, moving.ID, CreateTaskInput{Title: "Second child"})
	if err != nil {
		t.Fatal(err)
	}
	after, err := store.CreateTask(ctx, userID, source.ID, CreateTaskInput{Title: "After"})
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.CreateTask(ctx, userID, destination.ID, CreateTaskInput{Title: "First"})
	if err != nil {
		t.Fatal(err)
	}
	last, err := store.CreateTask(ctx, userID, destination.ID, CreateTaskInput{Title: "Last"})
	if err != nil {
		t.Fatal(err)
	}

	position := 1
	moved, err := store.MoveTask(ctx, userID, moving.ID, MoveTaskInput{BucketID: destination.ID, Position: &position})
	if err != nil {
		t.Fatal(err)
	}
	if moved.BoardID != destinationBoard.ID || moved.BucketID != destination.ID || moved.SortOrder != position {
		t.Fatalf("moved location = board %q, list %q, position %d", moved.BoardID, moved.BucketID, moved.SortOrder)
	}
	if moved.Title != moving.Title || moved.Description != moving.Description || moved.ScheduledDate != moving.ScheduledDate || moved.Status != moving.Status {
		t.Fatalf("moved metadata = %#v, want metadata from %#v", moved, moving)
	}
	assertTaskOrder(t, store, ctx, userID, source.ID, []string{before.ID, after.ID})
	assertTaskOrder(t, store, ctx, userID, destination.ID, []string{first.ID, moving.ID, firstChild.ID, secondChild.ID, last.ID})

	invalidPosition := 4
	if _, err := store.MoveTask(ctx, userID, moving.ID, MoveTaskInput{BucketID: source.ID, Position: &invalidPosition}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("invalid position error = %v, want ErrInvalidData", err)
	}
	assertTaskOrder(t, store, ctx, userID, source.ID, []string{before.ID, after.ID})
	assertTaskOrder(t, store, ctx, userID, destination.ID, []string{first.ID, moving.ID, firstChild.ID, secondChild.ID, last.ID})
}

func assertTaskOrder(t *testing.T, store *Store, ctx context.Context, userID string, bucketID string, want []string) {
	t.Helper()
	bucket, err := store.GetBucket(ctx, userID, bucketID)
	if err != nil {
		t.Fatal(err)
	}
	got := make([]string, len(bucket.Tasks))
	for index, task := range bucket.Tasks {
		got[index] = task.ID
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("task order = %v, want %v", got, want)
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
	position := 0
	if _, err := store.MoveTask(ctx, otherID, otherTask.ID, MoveTaskInput{BucketID: ownerList.ID, Position: &position}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-account atomic move error = %v, want ErrNotFound", err)
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

func TestBoardMaxTasksPerListIsLegacyMetadataOnly(t *testing.T) {
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
	if _, err := store.CreateTask(ctx, userID, first.ID, CreateTaskInput{Title: "third", Kind: KindAction}); err != nil {
		t.Fatalf("third task in first list: %v", err)
	}
	if _, err := store.CreateTask(ctx, userID, second.ID, CreateTaskInput{Title: "third", Kind: KindAction}); err != nil {
		t.Fatalf("third task in second list: %v", err)
	}

	next := 3
	if _, err := store.UpdateBoard(ctx, userID, board.ID, UpdateBoardInput{MaxTasksPerList: &next}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateTask(ctx, userID, first.ID, CreateTaskInput{Title: "still allowed", Kind: KindAction}); err != nil {
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

func TestUpdateBoardNameTrimsPersistsAndPreservesOwnerIsolation(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	ownerID := createIntegrationUser(t, ctx, db)
	otherID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id IN ($1, $2)", ownerID, otherID)
	})

	board, err := store.CreateBoard(ctx, ownerID, CreateBoardInput{Name: "Business"})
	if err != nil {
		t.Fatal(err)
	}
	list, err := store.CreateBucket(ctx, ownerID, board.ID, CreateBucketInput{Name: "Ideas"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateTask(ctx, ownerID, list.ID, CreateTaskInput{Title: "Keep me"}); err != nil {
		t.Fatal(err)
	}

	name := "  Growth plan  "
	updated, err := store.UpdateBoard(ctx, ownerID, board.ID, UpdateBoardInput{Name: &name})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "Growth plan" {
		t.Fatalf("updated name = %q, want %q", updated.Name, "Growth plan")
	}
	loaded, err := store.GetBoard(ctx, ownerID, board.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Name != "Growth plan" || len(loaded.Buckets) != 1 || len(loaded.Buckets[0].Tasks) != 1 || loaded.Buckets[0].Tasks[0].Title != "Keep me" {
		t.Fatalf("loaded board after rename = %#v", loaded)
	}

	blank := "   "
	if _, err := store.UpdateBoard(ctx, ownerID, board.ID, UpdateBoardInput{Name: &blank}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("blank rename error = %v, want ErrInvalidData", err)
	}
	if _, err := store.UpdateBoard(ctx, otherID, board.ID, UpdateBoardInput{Name: &name}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-account rename error = %v, want ErrNotFound", err)
	}
	if _, err := store.UpdateBoard(ctx, ownerID, "00000000-0000-0000-0000-000000000000", UpdateBoardInput{Name: &name}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing board rename error = %v, want ErrNotFound", err)
	}
	unchanged, err := store.GetBoard(ctx, ownerID, board.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Name != "Growth plan" {
		t.Fatalf("name after rejected renames = %q, want %q", unchanged.Name, "Growth plan")
	}
}

func TestConcurrentDisjointBoardUpdatesPreserveBothFields(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Business"})
	if err != nil {
		t.Fatal(err)
	}
	locker, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer locker.Rollback(ctx)
	if _, err := locker.Exec(ctx, "SELECT id FROM boards WHERE id = $1 FOR UPDATE", board.ID); err != nil {
		t.Fatal(err)
	}

	name := "Growth plan"
	limit := 12
	results := make(chan error, 2)
	go func() {
		_, err := store.UpdateBoard(ctx, userID, board.ID, UpdateBoardInput{Name: &name})
		results <- err
	}()
	go func() {
		_, err := store.UpdateBoard(ctx, userID, board.ID, UpdateBoardInput{MaxTasksPerList: &limit})
		results <- err
	}()

	waitForBlockedBoardUpdates(t, ctx, db, 2)
	if err := locker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}

	loaded, err := store.GetBoard(ctx, userID, board.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Name != name || loaded.MaxTasksPerList != limit {
		t.Fatalf("board after disjoint updates = name %q, limit %d; want name %q, limit %d", loaded.Name, loaded.MaxTasksPerList, name, limit)
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

func TestInboxCaptureIdempotencySurvivesInboxReplacement(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Capture"})
	if err != nil {
		t.Fatal(err)
	}
	firstInbox, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "First Inbox", IsInbox: true})
	if err != nil {
		t.Fatal(err)
	}
	replacement, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Replacement"})
	if err != nil {
		t.Fatal(err)
	}
	input := CreateTaskInput{Title: "Captured once", IdempotencyKey: "stable-inbox-capture"}
	first, err := store.CreateInboxTask(ctx, userID, input)
	if err != nil {
		t.Fatal(err)
	}
	if first.BucketID != firstInbox.ID {
		t.Fatalf("first capture list = %q, want %q", first.BucketID, firstInbox.ID)
	}

	trueValue, falseValue := true, false
	if _, err := store.UpdateBucket(ctx, userID, replacement.ID, UpdateBucketInput{IsInbox: &trueValue}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateBucket(ctx, userID, firstInbox.ID, UpdateBucketInput{IsInbox: &falseValue}); err != nil {
		t.Fatal(err)
	}
	retry, err := store.CreateInboxTask(ctx, userID, input)
	if err != nil {
		t.Fatal(err)
	}
	if retry.ID != first.ID || retry.BucketID != firstInbox.ID {
		t.Fatalf("retry = %#v, want original %#v", retry, first)
	}
	changed := input
	changed.Title = "Different capture"
	if _, err := store.CreateInboxTask(ctx, userID, changed); !errors.Is(err, ErrIdempotencyKey) {
		t.Fatalf("changed retry error = %v, want ErrIdempotencyKey", err)
	}

	second, err := store.CreateInboxTask(ctx, userID, CreateTaskInput{Title: "Captured after replacement", IdempotencyKey: "replacement-capture"})
	if err != nil {
		t.Fatal(err)
	}
	if second.BucketID != replacement.ID {
		t.Fatalf("new capture list = %q, want replacement %q", second.BucketID, replacement.ID)
	}
	if err := store.DeleteBucket(ctx, userID, firstInbox.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateInboxTask(ctx, userID, input); !errors.Is(err, ErrIdempotencyGone) {
		t.Fatalf("retry after original Inbox deletion error = %v, want ErrIdempotencyGone", err)
	}
}

func TestInboxCaptureSerializesResolutionAndCreationAgainstInboxDeletion(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Concurrent capture"})
	if err != nil {
		t.Fatal(err)
	}
	selectedInbox, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "First Inbox", IsInbox: true})
	if err != nil {
		t.Fatal(err)
	}
	replacementInbox, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Replacement Inbox", IsInbox: true})
	if err != nil {
		t.Fatal(err)
	}
	if inboxID, err := store.InboxBucketID(ctx, userID); err != nil || inboxID != selectedInbox.ID {
		t.Fatalf("selected Inbox = %q, %v; want %q", inboxID, err, selectedInbox.ID)
	}

	const idempotencyKey = "atomic-inbox-capture"
	idempotencyLock, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer idempotencyLock.Rollback(ctx)
	if _, err := idempotencyLock.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", userID+":"+idempotencyKey); err != nil {
		t.Fatal(err)
	}

	type captureResult struct {
		task Task
		err  error
	}
	captured := make(chan captureResult, 1)
	go func() {
		task, err := store.CreateInboxTask(ctx, userID, CreateTaskInput{
			Title:          "Atomic capture",
			IdempotencyKey: idempotencyKey,
		})
		captured <- captureResult{task: task, err: err}
	}()
	waitForBlockedQueryContaining(t, ctx, db, "pg_advisory_xact_lock")

	if err := store.DeleteBucket(ctx, userID, selectedInbox.ID); err != nil {
		t.Fatalf("delete selected Inbox: %v", err)
	}
	if err := idempotencyLock.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	result := <-captured
	if result.err != nil {
		t.Fatalf("capture racing Inbox deletion: %v", result.err)
	}
	if result.task.ID == "" || result.task.BucketID != replacementInbox.ID {
		t.Fatalf("capture = %#v, want replacement Inbox %q", result.task, replacementInbox.ID)
	}
	if inboxID, err := store.InboxBucketID(ctx, userID); err != nil || inboxID != replacementInbox.ID {
		t.Fatalf("remaining Inbox = %q, %v; want %q", inboxID, err, replacementInbox.ID)
	}
	persisted, err := store.GetTask(ctx, userID, result.task.ID)
	if err != nil {
		t.Fatalf("load captured task: %v", err)
	}
	if persisted.BucketID != replacementInbox.ID {
		t.Fatalf("persisted capture list = %q, want %q", persisted.BucketID, replacementInbox.ID)
	}
}

func TestTaskCreationAcceptsALegacyStoredFingerprint(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Legacy retries"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Ready"})
	if err != nil {
		t.Fatal(err)
	}
	input := CreateTaskInput{
		Title:          "Legacy retry",
		Description:    "Context",
		ScheduledDate:  "2026-08-12",
		Kind:           KindAction,
		IdempotencyKey: "legacy-client-request",
	}
	original, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{
		Title:         input.Title,
		Description:   input.Description,
		ScheduledDate: input.ScheduledDate,
		Kind:          input.Kind,
	})
	if err != nil {
		t.Fatal(err)
	}
	legacyFingerprint, err := topLevelTaskCreateFingerprint(
		bucket.ID,
		input.Title,
		input.Description,
		input.ScheduledDate,
		input.Kind,
		input.AssigneeAgentID,
		input.OverrideLimit,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO task_idempotency_keys (user_id, key, request_hash, task_id)
		VALUES ($1, $2, $3, $4)
	`, userID, input.IdempotencyKey, legacyFingerprint, original.ID); err != nil {
		t.Fatal(err)
	}

	retry, err := store.CreateTask(ctx, userID, bucket.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if retry.ID != original.ID {
		t.Fatalf("legacy retry task = %q, want original %q", retry.ID, original.ID)
	}
}

func TestTaskCreationAcceptsTheImmediatePredeploymentFingerprint(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Rolling deployment retries"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Ready"})
	if err != nil {
		t.Fatal(err)
	}
	input := CreateTaskInput{Title: "Retry during rollout", IdempotencyKey: "rolling-deployment-request"}
	original, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: input.Title})
	if err != nil {
		t.Fatal(err)
	}
	previousFingerprint, err := parentAwareTaskCreateFingerprint(
		bucket.ID,
		input.Title,
		input.Description,
		"",
		KindAction,
		input.AssigneeAgentID,
		"",
		input.OverrideLimit,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO task_idempotency_keys (user_id, key, request_hash, task_id)
		VALUES ($1, $2, $3, $4)
	`, userID, input.IdempotencyKey, previousFingerprint, original.ID); err != nil {
		t.Fatal(err)
	}

	retry, err := store.CreateTask(ctx, userID, bucket.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if retry.ID != original.ID {
		t.Fatalf("rolling deployment retry task = %q, want original %q", retry.ID, original.ID)
	}
}

func TestTopLevelTaskFingerprintKeepsLegacyShape(t *testing.T) {
	const bucketID = "00000000-0000-0000-0000-000000000001"
	const legacyFingerprint = "455c2f24afe83518bf7e89324993aec306c701c81cc6b21db9340888e7d5df05"

	fingerprint, err := taskCreateFingerprint(bucketID, "Legacy retry", "Context", "2026-08-12", KindAction, "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if fingerprint != legacyFingerprint {
		t.Fatalf("top-level fingerprint = %q, want legacy %q", fingerprint, legacyFingerprint)
	}
	subtaskFingerprint, err := taskCreateFingerprint(bucketID, "Legacy retry", "Context", "2026-08-12", KindAction, "", "00000000-0000-0000-0000-000000000002", false)
	if err != nil {
		t.Fatal(err)
	}
	if subtaskFingerprint == legacyFingerprint {
		t.Fatal("subtask fingerprint must include its parent task")
	}
}

func TestSubtaskCreationUsesParentInIdempotencyFingerprint(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Subtask retries"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Ready"})
	if err != nil {
		t.Fatal(err)
	}
	destination, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Working"})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Ship release"})
	if err != nil {
		t.Fatal(err)
	}
	input := CreateTaskInput{Title: "Write notes", IdempotencyKey: "subtask-request"}
	first, err := store.CreateSubtask(ctx, userID, parent.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	position := 0
	if _, err := store.MoveTask(ctx, userID, parent.ID, MoveTaskInput{BucketID: destination.ID, Position: &position}); err != nil {
		t.Fatal(err)
	}
	retry, err := store.CreateSubtask(ctx, userID, parent.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if retry.ID != first.ID {
		t.Fatalf("subtask retry created %q, want original %q", retry.ID, first.ID)
	}
	if retry.BucketID != destination.ID {
		t.Fatalf("retried subtask list = %q, want moved parent list %q", retry.BucketID, destination.ID)
	}

	changed := input
	changed.Title = "Write different notes"
	if _, err := store.CreateSubtask(ctx, userID, parent.ID, changed); !errors.Is(err, ErrIdempotencyKey) {
		t.Fatalf("changed subtask retry error = %v, want ErrIdempotencyKey", err)
	}
	if _, err := store.CreateTask(ctx, userID, bucket.ID, input); !errors.Is(err, ErrIdempotencyKey) {
		t.Fatalf("top-level reuse of subtask key error = %v, want ErrIdempotencyKey", err)
	}
	otherParent, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Publish announcement"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSubtask(ctx, userID, otherParent.ID, input); !errors.Is(err, ErrIdempotencyKey) {
		t.Fatalf("different-parent reuse of subtask key error = %v, want ErrIdempotencyKey", err)
	}
}

func TestPreparedSubtaskCreationResolvesTheLockedParentList(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Concurrent child creation"})
	if err != nil {
		t.Fatal(err)
	}
	originalList, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Ready"})
	if err != nil {
		t.Fatal(err)
	}
	destination, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Working"})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := store.CreateTask(ctx, userID, originalList.ID, CreateTaskInput{Title: "Ship release"})
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := prepareTaskCreate(CreateTaskInput{Title: "Write notes", ParentTaskID: parent.ID}, "parent:"+parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	position := 0
	if _, err := store.MoveTask(ctx, userID, parent.ID, MoveTaskInput{BucketID: destination.ID, Position: &position}); err != nil {
		t.Fatal(err)
	}
	child, err := store.createPreparedTask(ctx, userID, originalList.ID, prepared)
	if err != nil {
		t.Fatal(err)
	}
	if child.BucketID != destination.ID {
		t.Fatalf("child list = %q, want locked parent list %q", child.BucketID, destination.ID)
	}
}

func TestSubtaskCreationAcceptsThePredeploymentFingerprintAfterParentMoves(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Rolling child retries"})
	if err != nil {
		t.Fatal(err)
	}
	originalList, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Ready"})
	if err != nil {
		t.Fatal(err)
	}
	destination, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Working"})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := store.CreateTask(ctx, userID, originalList.ID, CreateTaskInput{Title: "Ship release"})
	if err != nil {
		t.Fatal(err)
	}
	input := CreateTaskInput{Title: "Write notes", IdempotencyKey: "predeployment-subtask-request"}
	original, err := store.CreateSubtask(ctx, userID, parent.ID, CreateTaskInput{Title: input.Title})
	if err != nil {
		t.Fatal(err)
	}
	previousFingerprint, err := parentAwareTaskCreateFingerprint(
		originalList.ID,
		input.Title,
		input.Description,
		"",
		KindAction,
		input.AssigneeAgentID,
		parent.ID,
		input.OverrideLimit,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO task_idempotency_keys (user_id, key, request_hash, task_id)
		VALUES ($1, $2, $3, $4)
	`, userID, input.IdempotencyKey, previousFingerprint, original.ID); err != nil {
		t.Fatal(err)
	}
	position := 0
	if _, err := store.MoveTask(ctx, userID, parent.ID, MoveTaskInput{BucketID: destination.ID, Position: &position}); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteBucket(ctx, userID, originalList.ID); err != nil {
		t.Fatal(err)
	}

	retry, err := store.CreateSubtask(ctx, userID, parent.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if retry.ID != original.ID {
		t.Fatalf("rolling deployment retry created %q, want original %q", retry.ID, original.ID)
	}
	if retry.BucketID != destination.ID {
		t.Fatalf("rolling deployment retry list = %q, want moved parent list %q", retry.BucketID, destination.ID)
	}
}

func TestSubtasksStayWithTheirParentWhenTasksMove(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	firstBoard, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "First"})
	if err != nil {
		t.Fatal(err)
	}
	firstList, err := store.CreateBucket(ctx, userID, firstBoard.ID, CreateBucketInput{Name: "Ready"})
	if err != nil {
		t.Fatal(err)
	}
	secondList, err := store.CreateBucket(ctx, userID, firstBoard.ID, CreateBucketInput{Name: "Working"})
	if err != nil {
		t.Fatal(err)
	}
	secondBoard, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Second"})
	if err != nil {
		t.Fatal(err)
	}
	thirdList, err := store.CreateBucket(ctx, userID, secondBoard.ID, CreateBucketInput{Name: "Review"})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := store.CreateTask(ctx, userID, firstList.ID, CreateTaskInput{Title: "Ship release"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := store.CreateSubtask(ctx, userID, parent.ID, CreateTaskInput{Title: "Human review"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := store.UpdateTaskForHuman(ctx, userID, child.ID, UpdateTaskInput{BucketID: &secondList.ID}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("direct subtask update error = %v, want ErrInvalidData", err)
	}
	position := 0
	if _, err := store.MoveTask(ctx, userID, child.ID, MoveTaskInput{BucketID: firstList.ID, Position: &position}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("same-list subtask move error = %v, want ErrInvalidData", err)
	}
	if _, err := store.MoveTask(ctx, userID, child.ID, MoveTaskInput{BucketID: secondList.ID, Position: &position}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("direct subtask move error = %v, want ErrInvalidData", err)
	}

	// Rows written before this invariant may already be split. Both human move
	// paths may repair them, but only by returning to the locked parent list.
	if _, err := db.Exec(ctx, `
		UPDATE tasks
		SET board_id = $2, bucket_id = $3, updated_at = now()
		WHERE id = $1
	`, child.ID, secondBoard.ID, thirdList.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateTaskForHuman(ctx, userID, child.ID, UpdateTaskInput{BucketID: &secondList.ID}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("legacy subtask update outside parent list error = %v, want ErrInvalidData", err)
	}
	if _, err := store.UpdateTaskForHuman(ctx, userID, child.ID, UpdateTaskInput{BucketID: &firstList.ID}); err != nil {
		t.Fatalf("repair legacy subtask with update: %v", err)
	}
	if _, err := db.Exec(ctx, `
		UPDATE tasks
		SET board_id = $2, bucket_id = $3, updated_at = now()
		WHERE id = $1
	`, child.ID, secondBoard.ID, thirdList.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.MoveTask(ctx, userID, child.ID, MoveTaskInput{BucketID: secondList.ID, Position: &position}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("legacy subtask move outside parent list error = %v, want ErrInvalidData", err)
	}
	repairPosition := 1
	if _, err := store.MoveTask(ctx, userID, child.ID, MoveTaskInput{BucketID: firstList.ID, Position: &repairPosition}); err != nil {
		t.Fatalf("repair legacy subtask with move: %v", err)
	}

	if _, err := store.UpdateTaskForHuman(ctx, userID, parent.ID, UpdateTaskInput{BucketID: &secondList.ID}); err != nil {
		t.Fatal(err)
	}
	childAfterUpdate, err := store.GetTask(ctx, userID, child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if childAfterUpdate.BucketID != secondList.ID || childAfterUpdate.BoardID != firstBoard.ID {
		t.Fatalf("child after parent update = %#v", childAfterUpdate)
	}

	if _, err := store.MoveTask(ctx, userID, parent.ID, MoveTaskInput{BucketID: thirdList.ID, Position: &position}); err != nil {
		t.Fatal(err)
	}
	childAfterMove, err := store.GetTask(ctx, userID, child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if childAfterMove.BucketID != thirdList.ID || childAfterMove.BoardID != secondBoard.ID {
		t.Fatalf("child after parent move = %#v", childAfterMove)
	}
}

func TestUpdateTaskMovesParentAndChildrenAsOrderedGroup(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Grouped moves"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Source"})
	if err != nil {
		t.Fatal(err)
	}
	destination, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Destination"})
	if err != nil {
		t.Fatal(err)
	}
	before, err := store.CreateTask(ctx, userID, source.ID, CreateTaskInput{Title: "Before"})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := store.CreateTask(ctx, userID, source.ID, CreateTaskInput{Title: "Parent"})
	if err != nil {
		t.Fatal(err)
	}
	firstChild, err := store.CreateSubtask(ctx, userID, parent.ID, CreateTaskInput{Title: "First child"})
	if err != nil {
		t.Fatal(err)
	}
	secondChild, err := store.CreateSubtask(ctx, userID, parent.ID, CreateTaskInput{Title: "Second child"})
	if err != nil {
		t.Fatal(err)
	}
	after, err := store.CreateTask(ctx, userID, source.ID, CreateTaskInput{Title: "After"})
	if err != nil {
		t.Fatal(err)
	}
	destinationFirst, err := store.CreateTask(ctx, userID, destination.ID, CreateTaskInput{Title: "Destination first"})
	if err != nil {
		t.Fatal(err)
	}
	destinationLast, err := store.CreateTask(ctx, userID, destination.ID, CreateTaskInput{Title: "Destination last"})
	if err != nil {
		t.Fatal(err)
	}

	requestedPosition := 1
	if _, err := store.UpdateTaskForHuman(ctx, userID, parent.ID, UpdateTaskInput{BucketID: &destination.ID, SortOrder: &requestedPosition}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("combined list and position update error = %v, want ErrInvalidData", err)
	}
	assertTaskOrder(t, store, ctx, userID, source.ID, []string{before.ID, parent.ID, firstChild.ID, secondChild.ID, after.ID})
	assertTaskOrder(t, store, ctx, userID, destination.ID, []string{destinationFirst.ID, destinationLast.ID})

	if _, err := store.UpdateTaskForHuman(ctx, userID, parent.ID, UpdateTaskInput{BucketID: &destination.ID}); err != nil {
		t.Fatal(err)
	}
	assertTaskOrder(t, store, ctx, userID, source.ID, []string{before.ID, after.ID})
	assertTaskOrder(t, store, ctx, userID, destination.ID, []string{parent.ID, firstChild.ID, secondChild.ID, destinationFirst.ID, destinationLast.ID})
}

func TestTaskMovesPreserveUnrelatedTaskTimestamps(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "History"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Source"})
	if err != nil {
		t.Fatal(err)
	}
	destination, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Destination"})
	if err != nil {
		t.Fatal(err)
	}
	sourceHistory, err := store.CreateTask(ctx, userID, source.ID, CreateTaskInput{Title: "Old source completion"})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := store.CreateTask(ctx, userID, source.ID, CreateTaskInput{Title: "Parent"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSubtask(ctx, userID, parent.ID, CreateTaskInput{Title: "Child"}); err != nil {
		t.Fatal(err)
	}
	destinationHistory, err := store.CreateTask(ctx, userID, destination.ID, CreateTaskInput{Title: "Old destination completion"})
	if err != nil {
		t.Fatal(err)
	}
	done := StatusDone
	for _, taskID := range []string{sourceHistory.ID, destinationHistory.ID} {
		if _, err := store.UpdateTaskForHuman(ctx, userID, taskID, UpdateTaskInput{Status: &done}); err != nil {
			t.Fatal(err)
		}
	}
	const oldTimestamp = "2020-01-02T03:04:05Z"
	if _, err := db.Exec(ctx, "UPDATE tasks SET updated_at = $1::timestamptz WHERE id = ANY($2::uuid[])", oldTimestamp, []string{sourceHistory.ID, destinationHistory.ID}); err != nil {
		t.Fatal(err)
	}

	if _, err := store.UpdateTaskForHuman(ctx, userID, parent.ID, UpdateTaskInput{BucketID: &destination.ID}); err != nil {
		t.Fatal(err)
	}
	position := 0
	if _, err := store.MoveTask(ctx, userID, parent.ID, MoveTaskInput{BucketID: source.ID, Position: &position}); err != nil {
		t.Fatal(err)
	}
	for _, taskID := range []string{sourceHistory.ID, destinationHistory.ID} {
		task, err := store.GetTask(ctx, userID, taskID)
		if err != nil {
			t.Fatal(err)
		}
		if task.UpdatedAt.UTC().Format(time.RFC3339) != oldTimestamp {
			t.Fatalf("unrelated task %s updated at %s, want %s", taskID, task.UpdatedAt.UTC().Format(time.RFC3339), oldTimestamp)
		}
	}
}

func TestSubtaskCreationRacingParentMoveNeverSplitsLists(t *testing.T) {
	for _, mutation := range []string{"update", "move"} {
		t.Run(mutation, func(t *testing.T) {
			db := openIntegrationDB(t)
			ctx := context.Background()
			store := NewStore(db)
			userID := createIntegrationUser(t, ctx, db)
			t.Cleanup(func() {
				_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
			})

			board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Work"})
			if err != nil {
				t.Fatal(err)
			}
			source, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Ready"})
			if err != nil {
				t.Fatal(err)
			}
			destination, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Working"})
			if err != nil {
				t.Fatal(err)
			}
			parent, err := store.CreateTask(ctx, userID, source.ID, CreateTaskInput{Title: "Parent"})
			if err != nil {
				t.Fatal(err)
			}

			parentLock, err := db.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer parentLock.Rollback(ctx)
			if _, err := lockedTask(ctx, parentLock, userID, parent.ID); err != nil {
				t.Fatal(err)
			}

			moveResult := make(chan error, 1)
			go func() {
				if mutation == "update" {
					_, err := store.UpdateTaskForHuman(ctx, userID, parent.ID, UpdateTaskInput{BucketID: &destination.ID})
					moveResult <- err
					return
				}
				position := 0
				_, err := store.MoveTask(ctx, userID, parent.ID, MoveTaskInput{BucketID: destination.ID, Position: &position})
				moveResult <- err
			}()
			waitForBlockedQueryContaining(t, ctx, db, "FOR UPDATE OF t")

			type createOutcome struct {
				task Task
				err  error
			}
			createResult := make(chan createOutcome, 1)
			go func() {
				task, err := store.CreateSubtask(ctx, userID, parent.ID, CreateTaskInput{Title: "Racing child"})
				createResult <- createOutcome{task: task, err: err}
			}()
			waitForBlockedQueryContaining(t, ctx, db, "FROM users u")

			if err := parentLock.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
			if err := <-moveResult; err != nil {
				t.Fatalf("parent move: %v", err)
			}
			created := <-createResult
			if created.err != nil {
				t.Fatalf("racing subtask creation: %v", created.err)
			}
			if created.task.BucketID != destination.ID {
				t.Fatalf("racing child list = %q, want locked parent list %q", created.task.BucketID, destination.ID)
			}

			var splitChildren int
			if err := db.QueryRow(ctx, `
				SELECT count(*)
				FROM tasks child
				JOIN tasks parent ON parent.id = child.parent_task_id
				WHERE child.parent_task_id = $1
				  AND (child.board_id <> parent.board_id OR child.bucket_id <> parent.bucket_id)
			`, parent.ID).Scan(&splitChildren); err != nil {
				t.Fatal(err)
			}
			if splitChildren != 0 {
				t.Fatalf("split children = %d, want 0", splitChildren)
			}

			child, err := store.CreateSubtask(ctx, userID, parent.ID, CreateTaskInput{Title: "Current child"})
			if err != nil {
				t.Fatal(err)
			}
			if child.BucketID != destination.ID {
				t.Fatalf("child list = %q, want %q", child.BucketID, destination.ID)
			}
		})
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
	value := true
	updated, err := store.UpdateBucket(ctx, userID, bucket.ID, UpdateBucketInput{IsInbox: &value})
	if err != nil || !updated.IsInbox {
		t.Fatalf("set Inbox = %#v, %v", updated, err)
	}
	replacement, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Replacement", IsInbox: true})
	if err != nil {
		t.Fatal(err)
	}
	value = false
	updated, err = store.UpdateBucket(ctx, userID, bucket.ID, UpdateBucketInput{IsInbox: &value})
	if err != nil || updated.IsInbox {
		t.Fatalf("clear Inbox with replacement = %#v, %v", updated, err)
	}
	resolved, err := store.InboxBucketID(ctx, userID)
	if err != nil || resolved != replacement.ID {
		t.Fatalf("resolved Inbox = %q, %v; want %q", resolved, err, replacement.ID)
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

func TestUnifiedListItemsAndActions(t *testing.T) {
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
	if _, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Second action", Kind: KindAction}); err != nil {
		t.Fatalf("second action: %v", err)
	}
	updatedTitle := "Record the camera comparison"
	unchangedKind := KindAction
	if _, err := store.UpdateTask(ctx, userID, action.ID, UpdateTaskInput{Title: &updatedTitle, Kind: &unchangedKind, BucketID: &bucket.ID}); err != nil {
		t.Fatalf("edit existing action in full list: %v", err)
	}
	completeAction := StatusDone
	if _, err := store.UpdateTask(ctx, userID, action.ID, UpdateTaskInput{Status: &completeAction}); err != nil {
		t.Fatal(err)
	}
	replacement, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Replacement action", Kind: KindAction})
	if err != nil {
		t.Fatal(err)
	}
	reopenAction := StatusQueued
	if _, err := store.UpdateTask(ctx, userID, action.ID, UpdateTaskInput{Status: &reopenAction}); err != nil {
		t.Fatalf("reopen action: %v", err)
	}
	if err := store.DeleteTask(ctx, userID, replacement.ID); err != nil {
		t.Fatal(err)
	}
	ready := StatusQueued
	if _, err := store.UpdateTaskForHuman(ctx, userID, reference.ID, UpdateTaskInput{Status: &ready}); err != nil {
		t.Fatalf("mark default list item ready: %v", err)
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
	if len(actions) != 4 {
		t.Fatalf("actions = %#v, want all four list items", actions)
	}
	loaded, err := store.GetBoard(ctx, userID, board.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Buckets[0].Goal != "Publish one strong video each week" || loaded.Buckets[0].OpenCount != 3 {
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
	if task.Description != "Compare the three strongest options." || task.ScheduledDate != "2026-07-13" || task.Status != StatusNew {
		t.Fatalf("created task = %#v", task)
	}
	if _, err := store.ClaimTask(ctx, userID, task.ID); !errors.Is(err, ErrTaskUnavailable) {
		t.Fatalf("new task claim error = %v, want ErrTaskUnavailable", err)
	}
	ready := StatusQueued
	if _, err := store.UpdateTaskForHuman(ctx, userID, task.ID, UpdateTaskInput{Status: &ready}); err != nil {
		t.Fatalf("mark task ready: %v", err)
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

	done := StatusDone
	description := "Chosen direction and rationale."
	noDate := ""
	completed, err := store.UpdateTask(ctx, userID, task.ID, UpdateTaskInput{Description: &description, ScheduledDate: &noDate, Status: &done})
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != StatusDone || completed.Description != description || completed.ScheduledDate != "" {
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

	for _, status := range []string{StatusQueued, StatusWorking, StatusNeedsReview, StatusDone, StatusNew} {
		updated, err := store.UpdateTaskForHuman(ctx, userID, task.ID, UpdateTaskInput{Status: &status})
		if err != nil {
			t.Fatalf("set %q: %v", status, err)
		}
		if updated.Status != status {
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
	if updated.Title != movedTitle || updated.BucketID != target.ID || updated.Status != StatusDone {
		t.Fatalf("atomic update = %#v", updated)
	}
	if _, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "Home blocker", Kind: KindAction}); err != nil {
		t.Fatal(err)
	}
	queued := StatusQueued
	reopenedTitle := "Reopened at home"
	if _, err := store.UpdateTaskForHuman(ctx, userID, task.ID, UpdateTaskInput{Title: &reopenedTitle, BucketID: &bucket.ID, Status: &queued}); err != nil {
		t.Fatalf("reopen into populated list: %v", err)
	}
	loaded, err := store.GetTask(ctx, userID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Title != reopenedTitle || loaded.BucketID != bucket.ID || loaded.Status != StatusQueued {
		t.Fatalf("reopened task = %#v", loaded)
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
	if _, err := db.Exec(ctx, `
		INSERT INTO entitlements (user_id, plan, source)
		VALUES ($1, 'pro', 'manual')
	`, id); err != nil {
		t.Fatal(err)
	}
	return id
}

func createFreeIntegrationUser(t *testing.T, ctx context.Context, db *database.Pool) string {
	t.Helper()
	email := fmt.Sprintf("free-%s-%d@slate.test", strings.ToLower(t.Name()), time.Now().UnixNano())
	var id string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, role)
		VALUES ($1, 'test', 'member')
		RETURNING id::text
	`, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func waitForBlockedBoardUpdates(t *testing.T, ctx context.Context, db *database.Pool, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var count int
		if err := db.QueryRow(ctx, `
			SELECT count(*)
			FROM pg_stat_activity
			WHERE datname = current_database()
			  AND pid <> pg_backend_pid()
			  AND state = 'active'
			  AND wait_event_type = 'Lock'
			  AND query LIKE '%UPDATE boards%'
		`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count >= want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d blocked board updates", want)
}

func waitForBlockedQueryContaining(t *testing.T, ctx context.Context, db *database.Pool, fragment string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var count int
		if err := db.QueryRow(ctx, `
			SELECT count(*)
			FROM pg_stat_activity
			WHERE datname = current_database()
			  AND pid <> pg_backend_pid()
			  AND state = 'active'
			  AND wait_event_type = 'Lock'
			  AND query LIKE '%' || $1 || '%'
		`, fragment).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for blocked query containing %q", fragment)
}
