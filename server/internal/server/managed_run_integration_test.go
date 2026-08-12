package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/boards"
	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/migrations"
)

type managedRunFixture struct {
	db      *database.Pool
	app     http.Handler
	store   *boards.Store
	owner   auth.User
	agent   auth.AgentUser
	token   string
	board   boards.Board
	bucket  boards.Bucket
	purpose string
}

func newManagedRunFixture(t *testing.T) *managedRunFixture {
	t.Helper()
	databaseURL := testDatabaseURL(t)
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
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("managed-run-owner-%d@slate.test", time.Now().UnixNano()), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", owner.ID) })

	purpose := "Implement assigned coding work"
	token := fmt.Sprintf("slate_managed_%d", time.Now().UnixNano())
	agent, err := authStore.CreateAgent(ctx, owner.ID, "Managed Agent", purpose, testTokenHash(token), "slate_managed")
	if err != nil {
		t.Fatal(err)
	}
	store := boards.NewStore(db)
	board, err := store.CreateBoard(ctx, owner.ID, boards.CreateBoardInput{Name: "Managed board"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, owner.ID, board.ID, boards.CreateBucketInput{Name: "Managed list"})
	if err != nil {
		t.Fatal(err)
	}
	return &managedRunFixture{
		db:      db,
		app:     NewApp(fstest.MapFS{"index.html": {Data: []byte("app")}}, db, false, auth.Options{}).Routes(),
		store:   store,
		owner:   owner,
		agent:   agent,
		token:   token,
		board:   board,
		bucket:  bucket,
		purpose: purpose,
	}
}

// readyTask creates an action assigned to the fixture agent and moves it to the
// Ready state a managed claim requires.
func (f *managedRunFixture) readyTask(t *testing.T, title string) boards.Task {
	t.Helper()
	ctx := context.Background()
	task, err := f.store.CreateTask(ctx, f.owner.ID, f.bucket.ID, boards.CreateTaskInput{Title: title, AssigneeAgentID: f.agent.ID})
	if err != nil {
		t.Fatal(err)
	}
	ready := boards.StatusQueued
	task, err = f.store.UpdateTaskForHuman(ctx, f.owner.ID, task.ID, boards.UpdateTaskInput{Status: &ready})
	if err != nil {
		t.Fatal(err)
	}
	return task
}

func (f *managedRunFixture) executionRunID(t *testing.T, taskID string) string {
	t.Helper()
	var runID string
	if err := f.db.QueryRow(context.Background(), "SELECT COALESCE(execution_run_id::text, '') FROM tasks WHERE id = $1", taskID).Scan(&runID); err != nil {
		t.Fatal(err)
	}
	return runID
}

func testDatabaseURL(t *testing.T) string {
	t.Helper()
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run managed run integration tests")
	}
	return databaseURL
}

// runRequest issues an agent request carrying an optional managed run identity.
func runRequest(t *testing.T, handler http.Handler, token string, runID string, method string, path string, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if runID != "" {
		request.Header.Set("X-Slate-Run-ID", runID)
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func entryBody(kind string, body string) string {
	encoded, err := json.Marshal(map[string]string{"kind": kind, "body": body})
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

func decodeEntries(t *testing.T, payload string) []map[string]any {
	t.Helper()
	var response struct {
		Entries []map[string]any `json:"entries"`
	}
	if err := json.Unmarshal([]byte(payload), &response); err != nil {
		t.Fatalf("decode entries %q: %v", payload, err)
	}
	return response.Entries
}

func errorCode(t *testing.T, payload string) string {
	t.Helper()
	var response struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal([]byte(payload), &response); err != nil {
		t.Fatalf("decode error %q: %v", payload, err)
	}
	return response.Code
}

func TestManagedClaimHasExactlyOneWinner(t *testing.T) {
	fixture := newManagedRunFixture(t)
	task := fixture.readyTask(t, "Race for one claim")

	runA := "11111111-1111-4111-8111-111111111111"
	runB := "22222222-2222-4222-8222-222222222222"
	results := make([]*httptest.ResponseRecorder, 2)
	var wait sync.WaitGroup
	start := make(chan struct{})
	for index, runID := range []string{runA, runB} {
		wait.Add(1)
		go func(index int, runID string) {
			defer wait.Done()
			<-start
			results[index] = runRequest(t, fixture.app, fixture.token, runID, http.MethodPost,
				"/api/v1/agent/tasks/"+task.ID+"/claim", `{}`, nil)
		}(index, runID)
	}
	close(start)
	wait.Wait()

	winners := 0
	for index, recorder := range results {
		switch recorder.Code {
		case http.StatusOK:
			winners++
		case http.StatusConflict:
		default:
			t.Fatalf("claim %d = %d %s", index, recorder.Code, recorder.Body.String())
		}
	}
	if winners != 1 {
		t.Fatalf("successful managed claims = %d, want 1", winners)
	}
	stored := fixture.executionRunID(t, task.ID)
	if stored != runA && stored != runB {
		t.Fatalf("stored run ID = %q, want one of the competing runs", stored)
	}
	if results[0].Code == http.StatusOK && stored != runA {
		t.Fatalf("stored run ID = %q, want the winning run %q", stored, runA)
	}
	if results[1].Code == http.StatusOK && stored != runB {
		t.Fatalf("stored run ID = %q, want the winning run %q", stored, runB)
	}
}

func TestManagedOutputMovesTheTaskToReviewAndReplaysExactly(t *testing.T) {
	fixture := newManagedRunFixture(t)
	task := fixture.readyTask(t, "Output moves to review")
	runID := "33333333-3333-4333-8333-333333333333"

	claim := runRequest(t, fixture.app, fixture.token, runID, http.MethodPost, "/api/v1/agent/tasks/"+task.ID+"/claim", `{}`, nil)
	if claim.Code != http.StatusOK {
		t.Fatalf("managed claim = %d %s", claim.Code, claim.Body.String())
	}

	key := "watch-run:" + task.ID + ":" + runID + ":output"
	output := runRequest(t, fixture.app, fixture.token, runID, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("output", "Implemented and verified."), map[string]string{"Idempotency-Key": key})
	if output.Code != http.StatusCreated {
		t.Fatalf("managed output = %d %s", output.Code, output.Body.String())
	}
	if !strings.Contains(output.Body.String(), `"cardStatus":"needs_review"`) {
		t.Fatalf("managed output card status = %s", output.Body.String())
	}

	var created map[string]any
	if err := json.Unmarshal(output.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created["runId"] != runID {
		t.Fatalf("output run tag = %v, want %q", created["runId"], runID)
	}

	replay := runRequest(t, fixture.app, fixture.token, runID, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("output", "Implemented and verified."), map[string]string{"Idempotency-Key": key})
	if replay.Code != http.StatusCreated {
		t.Fatalf("output replay from review = %d %s", replay.Code, replay.Body.String())
	}
	var replayed map[string]any
	if err := json.Unmarshal(replay.Body.Bytes(), &replayed); err != nil {
		t.Fatal(err)
	}
	if replayed["id"] != created["id"] {
		t.Fatalf("replayed entry = %v, want the original %v", replayed["id"], created["id"])
	}

	done := boards.StatusDone
	if _, err := fixture.store.UpdateTaskForHuman(context.Background(), fixture.owner.ID, task.ID, boards.UpdateTaskInput{Status: &done}); err != nil {
		t.Fatal(err)
	}
	doneReplay := runRequest(t, fixture.app, fixture.token, runID, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("output", "Implemented and verified."), map[string]string{"Idempotency-Key": key})
	if doneReplay.Code != http.StatusCreated {
		t.Fatalf("output replay from done = %d %s", doneReplay.Code, doneReplay.Body.String())
	}

	entries := decodeEntries(t, runRequest(t, fixture.app, fixture.token, runID, http.MethodGet,
		"/api/v1/tasks/"+task.ID+"/entries?runId="+runID, "", nil).Body.String())
	outputs := 0
	for _, entry := range entries {
		if entry["kind"] == "output" {
			outputs++
		}
	}
	if outputs != 1 {
		t.Fatalf("run tagged outputs = %d, want exactly 1", outputs)
	}
}

func TestManagedRunFencesMissingAndStaleRunIdentities(t *testing.T) {
	fixture := newManagedRunFixture(t)
	task := fixture.readyTask(t, "Fence stale runs")
	owner := "44444444-4444-4444-8444-444444444444"
	stale := "55555555-5555-4555-8555-555555555555"

	beforeClaim := runRequest(t, fixture.app, fixture.token, owner, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("output", "Too early."), map[string]string{"Idempotency-Key": "early"})
	if beforeClaim.Code != http.StatusConflict || errorCode(t, beforeClaim.Body.String()) != "run_conflict" {
		t.Fatalf("output before claim = %d %s", beforeClaim.Code, beforeClaim.Body.String())
	}

	claim := runRequest(t, fixture.app, fixture.token, owner, http.MethodPost, "/api/v1/agent/tasks/"+task.ID+"/claim", `{}`, nil)
	if claim.Code != http.StatusOK {
		t.Fatalf("managed claim = %d %s", claim.Code, claim.Body.String())
	}

	fenced := []struct {
		name    string
		runID   string
		method  string
		path    string
		body    string
		headers map[string]string
	}{
		{"stale comment", stale, http.MethodPost, "/api/v1/tasks/" + task.ID + "/entries", entryBody("comment", "Stale note."), map[string]string{"Idempotency-Key": "stale-comment"}},
		{"stale output", stale, http.MethodPost, "/api/v1/tasks/" + task.ID + "/entries", entryBody("output", "Stale report."), map[string]string{"Idempotency-Key": "stale-output"}},
		{"stale status", stale, http.MethodPatch, "/api/v1/agent/tasks/" + task.ID + "/status", `{"status":"needs_review"}`, nil},
		{"missing comment", "", http.MethodPost, "/api/v1/tasks/" + task.ID + "/entries", entryBody("comment", "Unfenced note."), map[string]string{"Idempotency-Key": "missing-comment"}},
		{"missing output", "", http.MethodPost, "/api/v1/tasks/" + task.ID + "/entries", entryBody("output", "Unfenced report."), map[string]string{"Idempotency-Key": "missing-output"}},
		{"missing status", "", http.MethodPatch, "/api/v1/agent/tasks/" + task.ID + "/status", `{"status":"needs_review"}`, nil},
	}
	for _, attempt := range fenced {
		recorder := runRequest(t, fixture.app, fixture.token, attempt.runID, attempt.method, attempt.path, attempt.body, attempt.headers)
		if recorder.Code != http.StatusConflict || errorCode(t, recorder.Body.String()) != "run_conflict" {
			t.Errorf("%s = %d %s, want 409 run_conflict", attempt.name, recorder.Code, recorder.Body.String())
		}
	}

	locked := runRequest(t, fixture.app, fixture.token, owner, http.MethodPatch, "/api/v1/agent/tasks/"+task.ID+"/status", `{"status":"needs_review"}`, nil)
	if locked.Code != http.StatusConflict || errorCode(t, locked.Body.String()) != "managed_run_status_locked" {
		t.Fatalf("managed status change = %d %s, want 409 managed_run_status_locked", locked.Code, locked.Body.String())
	}
	lockedDone := runRequest(t, fixture.app, fixture.token, owner, http.MethodPost, "/api/v1/agent/tasks/"+task.ID+"/done", "", nil)
	if lockedDone.Code != http.StatusConflict || errorCode(t, lockedDone.Body.String()) != "managed_run_status_locked" {
		t.Fatalf("managed done = %d %s, want 409 managed_run_status_locked", lockedDone.Code, lockedDone.Body.String())
	}

	current, err := fixture.store.GetTask(context.Background(), fixture.owner.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Status != boards.StatusWorking {
		t.Fatalf("task status after fenced attempts = %q, want working", current.Status)
	}

	blocked := runRequest(t, fixture.app, fixture.token, owner, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("comment", "Blocked on a missing decision."), map[string]string{"Idempotency-Key": "blocked"})
	if blocked.Code != http.StatusCreated {
		t.Fatalf("owning run comment = %d %s", blocked.Code, blocked.Body.String())
	}
	after, err := fixture.store.GetTask(context.Background(), fixture.owner.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != boards.StatusWorking {
		t.Fatalf("task status after blocked comment = %q, want working", after.Status)
	}
}

func TestOnlyAWorkflowTransitionReleasesTheRunFence(t *testing.T) {
	fixture := newManagedRunFixture(t)
	task := fixture.readyTask(t, "Edits must not release the fence")
	runID := "99999999-9999-4999-8999-999999999999"
	ctx := context.Background()

	if claim := runRequest(t, fixture.app, fixture.token, runID, http.MethodPost, "/api/v1/agent/tasks/"+task.ID+"/claim", `{}`, nil); claim.Code != http.StatusOK {
		t.Fatalf("managed claim = %d %s", claim.Code, claim.Body.String())
	}
	output := runRequest(t, fixture.app, fixture.token, runID, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("output", "Implemented."), map[string]string{"Idempotency-Key": "output"})
	if output.Code != http.StatusCreated {
		t.Fatalf("managed output = %d %s", output.Code, output.Body.String())
	}
	if held := fixture.executionRunID(t, task.ID); held != runID {
		t.Fatalf("run ID after output = %q, want %q", held, runID)
	}

	// A reviewer editing the card is not a workflow transition, so the fence
	// must survive it.
	title := "Edits must not release the fence (reviewed)"
	if _, err := fixture.store.UpdateTaskForHuman(ctx, fixture.owner.ID, task.ID, boards.UpdateTaskInput{Title: &title}); err != nil {
		t.Fatal(err)
	}
	if held := fixture.executionRunID(t, task.ID); held != runID {
		t.Fatalf("run ID after a human edit of a reviewed card = %q, want %q", held, runID)
	}
	unfenced := runRequest(t, fixture.app, fixture.token, "", http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("comment", "No run identity."), map[string]string{"Idempotency-Key": "unfenced"})
	if unfenced.Code != http.StatusConflict || errorCode(t, unfenced.Body.String()) != "run_conflict" {
		t.Fatalf("comment without a run on a fenced card = %d %s, want 409 run_conflict", unfenced.Code, unfenced.Body.String())
	}
	statusAttempt := runRequest(t, fixture.app, fixture.token, "", http.MethodPatch, "/api/v1/agent/tasks/"+task.ID+"/status", `{"status":"done"}`, nil)
	if statusAttempt.Code != http.StatusConflict || errorCode(t, statusAttempt.Body.String()) != "run_conflict" {
		t.Fatalf("status without a run on a fenced card = %d %s, want 409 run_conflict", statusAttempt.Code, statusAttempt.Body.String())
	}

	// Handing the card to another agent ends the run, because a run is bound to
	// one task and one agent. Without this the new assignee would be refused
	// with a conflict naming a run that was never its own.
	second, err := auth.NewPGStore(fixture.db).CreateAgent(ctx, fixture.owner.ID, "Second Agent", "",
		testTokenHash("slate_second_agent"), "slate_second")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.store.UpdateTaskForHuman(ctx, fixture.owner.ID, task.ID, boards.UpdateTaskInput{AssigneeAgentID: &second.ID}); err != nil {
		t.Fatal(err)
	}
	if held := fixture.executionRunID(t, task.ID); held != "" {
		t.Fatalf("run ID after reassignment = %q, want cleared", held)
	}
	handover := runRequest(t, fixture.app, "slate_second_agent", "", http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("comment", "Picking this up."), map[string]string{"Idempotency-Key": "handover"})
	if handover.Code != http.StatusCreated {
		t.Fatalf("new assignee comment = %d %s, want the handover to be accepted", handover.Code, handover.Body.String())
	}
	if _, err := fixture.store.UpdateTaskForHuman(ctx, fixture.owner.ID, task.ID, boards.UpdateTaskInput{AssigneeAgentID: &fixture.agent.ID}); err != nil {
		t.Fatal(err)
	}

	// Completing and then requeueing are transitions, and the requeue releases
	// the fence for the next claim.
	done := boards.StatusDone
	if _, err := fixture.store.UpdateTaskForHuman(ctx, fixture.owner.ID, task.ID, boards.UpdateTaskInput{Status: &done}); err != nil {
		t.Fatal(err)
	}
	if released := fixture.executionRunID(t, task.ID); released != "" {
		t.Fatalf("run ID after completion = %q, want cleared", released)
	}
}

func TestTaskEditsAreFencedToTheOwningRun(t *testing.T) {
	fixture := newManagedRunFixture(t)
	task := fixture.readyTask(t, "Edits are fenced too")
	runID := "12121212-1212-4121-8121-121212121212"
	stale := "13131313-1313-4131-8131-131313131313"

	if claim := runRequest(t, fixture.app, fixture.token, runID, http.MethodPost, "/api/v1/agent/tasks/"+task.ID+"/claim", `{}`, nil); claim.Code != http.StatusOK {
		t.Fatalf("managed claim = %d %s", claim.Code, claim.Body.String())
	}

	// The owning run may edit its task while it works.
	owned := runRequest(t, fixture.app, fixture.token, runID, http.MethodPatch, "/api/v1/tasks/"+task.ID, `{"description":"Progress so far."}`, nil)
	if owned.Code != http.StatusOK || !strings.Contains(owned.Body.String(), "Progress so far.") {
		t.Fatalf("owning run edit = %d %s", owned.Code, owned.Body.String())
	}

	fenced := []struct {
		name  string
		runID string
		body  string
		code  string
	}{
		{"missing run edit", "", `{"description":"Unfenced."}`, "run_conflict"},
		{"stale run edit", stale, `{"description":"Stale."}`, "run_conflict"},
		{"owning run status", runID, `{"status":"needs_review"}`, "managed_run_status_locked"},
	}
	for _, attempt := range fenced {
		recorder := runRequest(t, fixture.app, fixture.token, attempt.runID, http.MethodPatch, "/api/v1/tasks/"+task.ID, attempt.body, nil)
		if recorder.Code != http.StatusConflict || errorCode(t, recorder.Body.String()) != attempt.code {
			t.Errorf("%s = %d %s, want 409 %s", attempt.name, recorder.Code, recorder.Body.String(), attempt.code)
		}
	}

	current, err := fixture.store.GetTask(context.Background(), fixture.owner.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.Description != "Progress so far." || current.Status != boards.StatusWorking {
		t.Fatalf("task after fenced edits = %q / %q", current.Description, current.Status)
	}
}

func TestAnUppercaseRunIdentityStillOwnsItsTask(t *testing.T) {
	fixture := newManagedRunFixture(t)
	task := fixture.readyTask(t, "Uppercase run keeps ownership")
	upper := "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"
	lower := strings.ToLower(upper)

	if claim := runRequest(t, fixture.app, fixture.token, upper, http.MethodPost, "/api/v1/agent/tasks/"+task.ID+"/claim", `{}`, nil); claim.Code != http.StatusOK {
		t.Fatalf("uppercase claim = %d %s", claim.Code, claim.Body.String())
	}
	if stored := fixture.executionRunID(t, task.ID); stored != lower {
		t.Fatalf("stored run ID = %q, want the normalized %q", stored, lower)
	}
	// The same run repeating its own identity must not be fenced out.
	output := runRequest(t, fixture.app, fixture.token, upper, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("output", "Done."), map[string]string{"Idempotency-Key": "upper"})
	if output.Code != http.StatusCreated {
		t.Fatalf("uppercase output = %d %s, want the owning run to be accepted", output.Code, output.Body.String())
	}
	entries := decodeEntries(t, runRequest(t, fixture.app, fixture.token, upper, http.MethodGet,
		"/api/v1/tasks/"+task.ID+"/entries?runId="+upper, "", nil).Body.String())
	if len(entries) != 1 || entries[0]["runId"] != lower {
		t.Fatalf("entries for the uppercase run = %v, want one entry tagged %q", entries, lower)
	}
}

func TestEntryRunFilterReturnsOnlyTheExactRun(t *testing.T) {
	fixture := newManagedRunFixture(t)
	task := fixture.readyTask(t, "Filter entries by run")
	firstRun := "66666666-6666-4666-8666-666666666666"
	secondRun := "77777777-7777-4777-8777-777777777777"

	if claim := runRequest(t, fixture.app, fixture.token, firstRun, http.MethodPost, "/api/v1/agent/tasks/"+task.ID+"/claim", `{}`, nil); claim.Code != http.StatusOK {
		t.Fatalf("first claim = %d %s", claim.Code, claim.Body.String())
	}
	if comment := runRequest(t, fixture.app, fixture.token, firstRun, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("comment", "First run note."), map[string]string{"Idempotency-Key": "first"}); comment.Code != http.StatusCreated {
		t.Fatalf("first run comment = %d %s", comment.Code, comment.Body.String())
	}

	// A human requeue releases the fence so a second managed run can claim.
	ready := boards.StatusQueued
	if _, err := fixture.store.UpdateTaskForHuman(context.Background(), fixture.owner.ID, task.ID, boards.UpdateTaskInput{Status: &ready}); err != nil {
		t.Fatal(err)
	}
	if released := fixture.executionRunID(t, task.ID); released != "" {
		t.Fatalf("run ID after requeue = %q, want cleared", released)
	}
	if claim := runRequest(t, fixture.app, fixture.token, secondRun, http.MethodPost, "/api/v1/agent/tasks/"+task.ID+"/claim", `{}`, nil); claim.Code != http.StatusOK {
		t.Fatalf("second claim = %d %s", claim.Code, claim.Body.String())
	}
	if comment := runRequest(t, fixture.app, fixture.token, secondRun, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("comment", "Second run note."), map[string]string{"Idempotency-Key": "second"}); comment.Code != http.StatusCreated {
		t.Fatalf("second run comment = %d %s", comment.Code, comment.Body.String())
	}

	filtered := runRequest(t, fixture.app, fixture.token, secondRun, http.MethodGet, "/api/v1/tasks/"+task.ID+"/entries?runId="+secondRun, "", nil)
	if filtered.Code != http.StatusOK {
		t.Fatalf("filtered entries = %d %s", filtered.Code, filtered.Body.String())
	}
	entries := decodeEntries(t, filtered.Body.String())
	if len(entries) != 1 || entries[0]["body"] != "Second run note." || entries[0]["runId"] != secondRun {
		t.Fatalf("filtered entries = %v, want only the second run", entries)
	}
	if _, exposed := entries[0]["idempotencyKey"]; exposed {
		t.Fatalf("filtered entry exposed an idempotency key: %v", entries[0])
	}

	all := decodeEntries(t, runRequest(t, fixture.app, fixture.token, "", http.MethodGet, "/api/v1/tasks/"+task.ID+"/entries", "", nil).Body.String())
	if len(all) != 2 {
		t.Fatalf("unfiltered entries = %d, want 2", len(all))
	}

	invalid := runRequest(t, fixture.app, fixture.token, "", http.MethodGet, "/api/v1/tasks/"+task.ID+"/entries?runId=not-a-run", "", nil)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid run filter = %d %s, want 400", invalid.Code, invalid.Body.String())
	}
	badHeader := runRequest(t, fixture.app, fixture.token, "not-a-run", http.MethodPost, "/api/v1/agent/tasks/"+task.ID+"/claim", `{}`, nil)
	if badHeader.Code != http.StatusBadRequest {
		t.Fatalf("invalid run header = %d %s, want 400", badHeader.Code, badHeader.Body.String())
	}
}

func TestLegacyAgentWorkflowKeepsDirectStatusChanges(t *testing.T) {
	fixture := newManagedRunFixture(t)
	task := fixture.readyTask(t, "Legacy claim keeps status")

	claim := runRequest(t, fixture.app, fixture.token, "", http.MethodPost, "/api/v1/agent/tasks/"+task.ID+"/claim", `{}`, nil)
	if claim.Code != http.StatusOK || !strings.Contains(claim.Body.String(), `"status":"working"`) {
		t.Fatalf("legacy claim = %d %s", claim.Code, claim.Body.String())
	}
	if stored := fixture.executionRunID(t, task.ID); stored != "" {
		t.Fatalf("legacy claim stored run ID %q, want none", stored)
	}
	comment := runRequest(t, fixture.app, fixture.token, "", http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("comment", "Legacy progress note."), map[string]string{"Idempotency-Key": "legacy-comment"})
	if comment.Code != http.StatusCreated {
		t.Fatalf("legacy comment = %d %s", comment.Code, comment.Body.String())
	}
	entries := decodeEntries(t, runRequest(t, fixture.app, fixture.token, "", http.MethodGet, "/api/v1/tasks/"+task.ID+"/entries", "", nil).Body.String())
	if len(entries) != 1 {
		t.Fatalf("legacy entries = %d, want 1", len(entries))
	}
	if runTag, tagged := entries[0]["runId"]; tagged {
		t.Fatalf("legacy entry carried a run tag %v", runTag)
	}
	var storedRunTags int
	if err := fixture.db.QueryRow(context.Background(),
		"SELECT count(*) FROM card_entries WHERE task_id = $1 AND run_id IS NOT NULL", task.ID).Scan(&storedRunTags); err != nil {
		t.Fatal(err)
	}
	if storedRunTags != 0 {
		t.Fatalf("stored legacy run tags = %d, want 0", storedRunTags)
	}
	status := runRequest(t, fixture.app, fixture.token, "", http.MethodPatch, "/api/v1/agent/tasks/"+task.ID+"/status", `{"status":"needs_review"}`, nil)
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"status":"needs_review"`) {
		t.Fatalf("legacy status change = %d %s", status.Code, status.Body.String())
	}
}

func TestHumanCredentialsAreNotFencedByALiveManagedRun(t *testing.T) {
	fixture := newManagedRunFixture(t)
	task := fixture.readyTask(t, "Humans stay in control")
	runID := "88888888-8888-4888-8888-888888888888"

	if claim := runRequest(t, fixture.app, fixture.token, runID, http.MethodPost, "/api/v1/agent/tasks/"+task.ID+"/claim", `{}`, nil); claim.Code != http.StatusOK {
		t.Fatalf("managed claim = %d %s", claim.Code, claim.Body.String())
	}

	ctx := context.Background()
	// The owner comments on a card another managed run owns.
	entry, err := fixture.store.CreateCardEntry(ctx, fixture.owner.ID, "", "Owner", task.ID,
		boards.CreateCardEntryInput{Kind: "comment", Body: "Any update?"})
	if err != nil {
		t.Fatalf("human comment on a managed task: %v", err)
	}
	if entry.RunID != "" {
		t.Fatalf("human entry run tag = %q, want none", entry.RunID)
	}
	// The owner edits and then requeues the card, which releases the fence.
	title := "Humans stay in control (edited)"
	if _, err := fixture.store.UpdateTaskForHuman(ctx, fixture.owner.ID, task.ID, boards.UpdateTaskInput{Title: &title}); err != nil {
		t.Fatalf("human edit of a managed task: %v", err)
	}
	if held := fixture.executionRunID(t, task.ID); held != runID {
		t.Fatalf("run ID after a human edit that kept working = %q, want %q", held, runID)
	}
	ready := boards.StatusQueued
	if _, err := fixture.store.UpdateTaskForHuman(ctx, fixture.owner.ID, task.ID, boards.UpdateTaskInput{Status: &ready}); err != nil {
		t.Fatalf("human requeue of a managed task: %v", err)
	}
	if released := fixture.executionRunID(t, task.ID); released != "" {
		t.Fatalf("run ID after requeue = %q, want cleared", released)
	}
	// The fenced-out run can no longer act on the released card.
	stale := runRequest(t, fixture.app, fixture.token, runID, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries",
		entryBody("output", "Late report."), map[string]string{"Idempotency-Key": "late"})
	if stale.Code != http.StatusConflict || errorCode(t, stale.Body.String()) != "run_conflict" {
		t.Fatalf("released run output = %d %s, want 409 run_conflict", stale.Code, stale.Body.String())
	}
}

func TestAgentQueueOrdersByPriorityThenAge(t *testing.T) {
	fixture := newManagedRunFixture(t)
	ctx := context.Background()

	type seed struct {
		title    string
		priority string
	}
	// Created oldest first so age ordering is observable inside each group.
	seeds := []seed{
		{"unprioritized oldest", boards.PriorityNone},
		{"p2 oldest", boards.PriorityP2},
		{"p1 oldest", boards.PriorityP1},
		{"p0 oldest", boards.PriorityP0},
		{"p0 newest", boards.PriorityP0},
	}
	for _, item := range seeds {
		task := fixture.readyTask(t, item.title)
		if item.priority != boards.PriorityNone {
			priority := item.priority
			if _, err := fixture.store.UpdateTaskForHuman(ctx, fixture.owner.ID, task.ID, boards.UpdateTaskInput{Priority: &priority}); err != nil {
				t.Fatal(err)
			}
		}
		// Distinct creation timestamps keep the age comparison deterministic.
		if _, err := fixture.db.Exec(ctx, "UPDATE tasks SET created_at = now() + make_interval(secs => $2) WHERE id = $1", task.ID, seedOffset(item.title)); err != nil {
			t.Fatal(err)
		}
	}

	queue := runRequest(t, fixture.app, fixture.token, "", http.MethodGet, "/api/v1/agent/tasks", "", nil)
	if queue.Code != http.StatusOK {
		t.Fatalf("agent queue = %d %s", queue.Code, queue.Body.String())
	}
	var page struct {
		Tasks []struct {
			Title string `json:"title"`
		} `json:"tasks"`
	}
	if err := json.Unmarshal(queue.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	want := []string{"p0 oldest", "p0 newest", "p1 oldest", "p2 oldest", "unprioritized oldest"}
	if len(page.Tasks) != len(want) {
		t.Fatalf("queue length = %d, want %d (%s)", len(page.Tasks), len(want), queue.Body.String())
	}
	for index, title := range want {
		if page.Tasks[index].Title != title {
			t.Fatalf("queue order = %v, want %v", page.Tasks, want)
		}
	}
}

// queueTitles reads one agent queue page and returns its titles and next cursor.
func queueTitles(t *testing.T, fixture *managedRunFixture, query string) ([]string, string) {
	t.Helper()
	recorder := runRequest(t, fixture.app, fixture.token, "", http.MethodGet, "/api/v1/agent/tasks?"+query, "", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("agent queue ?%s = %d %s", query, recorder.Code, recorder.Body.String())
	}
	var page struct {
		Tasks []struct {
			Title string `json:"title"`
		} `json:"tasks"`
		NextCursor string `json:"nextCursor"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	titles := make([]string, 0, len(page.Tasks))
	for _, task := range page.Tasks {
		titles = append(titles, task.Title)
	}
	return titles, page.NextCursor
}

// pageThroughQueue walks every page and fails if the walk does not terminate.
func pageThroughQueue(t *testing.T, fixture *managedRunFixture, query string) []string {
	t.Helper()
	var collected []string
	cursor := ""
	for page := 0; page < 20; page++ {
		pageQuery := query
		if cursor != "" {
			pageQuery += "&cursor=" + url.QueryEscape(cursor)
		}
		titles, next := queueTitles(t, fixture, pageQuery)
		collected = append(collected, titles...)
		if next == "" {
			return collected
		}
		cursor = next
	}
	t.Fatalf("agent queue paging did not finish for ?%s", query)
	return nil
}

func TestAgentQueuePagingReturnsEveryTaskExactlyOnce(t *testing.T) {
	fixture := newManagedRunFixture(t)
	ctx := context.Background()
	seeds := []struct {
		title    string
		priority string
	}{
		{"unprioritized oldest", boards.PriorityNone},
		{"p2 oldest", boards.PriorityP2},
		{"p1 oldest", boards.PriorityP1},
		{"p0 oldest", boards.PriorityP0},
		{"p0 newest", boards.PriorityP0},
	}
	var ready []boards.Task
	for _, item := range seeds {
		task := fixture.readyTask(t, item.title)
		if item.priority != boards.PriorityNone {
			priority := item.priority
			if _, err := fixture.store.UpdateTaskForHuman(ctx, fixture.owner.ID, task.ID, boards.UpdateTaskInput{Priority: &priority}); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := fixture.db.Exec(ctx, "UPDATE tasks SET created_at = now() + make_interval(secs => $2) WHERE id = $1", task.ID, seedOffset(item.title)); err != nil {
			t.Fatal(err)
		}
		ready = append(ready, task)
	}

	singlePage, cursor := queueTitles(t, fixture, "limit=100")
	if cursor != "" {
		t.Fatalf("single page returned a cursor %q", cursor)
	}
	paged := pageThroughQueue(t, fixture, "limit=2")
	if strings.Join(paged, "|") != strings.Join(singlePage, "|") {
		t.Fatalf("paged queue = %v, want the single-page order %v", paged, singlePage)
	}

	// The same walk must hold for completed work, where the queue keeps age
	// ordering while the human history page orders by recent update.
	done := boards.StatusDone
	for _, task := range ready {
		if _, err := fixture.store.UpdateTaskForHuman(ctx, fixture.owner.ID, task.ID, boards.UpdateTaskInput{Status: &done}); err != nil {
			t.Fatal(err)
		}
	}
	completedSinglePage, cursor := queueTitles(t, fixture, "status=done&limit=100")
	if cursor != "" {
		t.Fatalf("completed single page returned a cursor %q", cursor)
	}
	if len(completedSinglePage) != len(seeds) {
		t.Fatalf("completed queue = %v, want %d tasks", completedSinglePage, len(seeds))
	}
	completedPaged := pageThroughQueue(t, fixture, "status=done&limit=2")
	if strings.Join(completedPaged, "|") != strings.Join(completedSinglePage, "|") {
		t.Fatalf("paged completed queue = %v, want the single-page order %v", completedPaged, completedSinglePage)
	}
}

// seedOffset spreads created_at so the expected queue order is unambiguous.
func seedOffset(title string) int {
	switch title {
	case "unprioritized oldest":
		return 1
	case "p2 oldest":
		return 2
	case "p1 oldest":
		return 3
	case "p0 oldest":
		return 4
	default:
		return 5
	}
}

func TestMeReportsAgentIdentityPurposeAndManagedRunCapability(t *testing.T) {
	fixture := newManagedRunFixture(t)

	agentMe := runRequest(t, fixture.app, fixture.token, "", http.MethodGet, "/api/v1/me", "", nil)
	if agentMe.Code != http.StatusOK {
		t.Fatalf("agent /me = %d %s", agentMe.Code, agentMe.Body.String())
	}
	var response struct {
		Authenticated bool `json:"authenticated"`
		User          struct {
			AgentID      string `json:"agentId"`
			AgentPurpose string `json:"agentPurpose"`
			DisplayName  string `json:"displayName"`
		} `json:"user"`
		Capabilities struct {
			ManagedRuns bool `json:"managedRuns"`
		} `json:"capabilities"`
	}
	if err := json.Unmarshal(agentMe.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.Authenticated || response.User.AgentID != fixture.agent.ID {
		t.Fatalf("agent /me identity = %+v, want agent %q", response, fixture.agent.ID)
	}
	if response.User.AgentPurpose != fixture.purpose {
		t.Fatalf("agent purpose = %q, want %q", response.User.AgentPurpose, fixture.purpose)
	}
	if response.User.DisplayName != "Managed Agent" {
		t.Fatalf("agent display name = %q", response.User.DisplayName)
	}
	if !response.Capabilities.ManagedRuns {
		t.Fatalf("managed run capability = false, want true")
	}
	if strings.Contains(agentMe.Body.String(), fixture.token) {
		t.Fatalf("/me leaked the credential")
	}
}
