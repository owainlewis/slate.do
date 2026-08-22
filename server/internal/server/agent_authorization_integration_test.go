package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/boards"
	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/migrations"
)

func TestAgentCredentialsCannotCrossTaskOrAccountResourceBoundaries(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run server integration tests")
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
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-route-owner-%d@slate.test", time.Now().UnixNano()), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", owner.ID) })

	agentAToken := fmt.Sprintf("slate_agent_a_%d", time.Now().UnixNano())
	agentBToken := fmt.Sprintf("slate_agent_b_%d", time.Now().UnixNano())
	agentA, err := authStore.CreateAgent(ctx, owner.ID, "Agent A", "", testTokenHash(agentAToken), "slate_agent_a")
	if err != nil {
		t.Fatal(err)
	}
	agentB, err := authStore.CreateAgent(ctx, owner.ID, "Agent B", "", testTokenHash(agentBToken), "slate_agent_b")
	if err != nil {
		t.Fatal(err)
	}
	if identity, err := authStore.FindUserByAPITokenHash(ctx, testTokenHash(agentAToken), time.Now()); err != nil || identity.AgentID != agentA.ID {
		t.Fatalf("resolve agent A credential = %#v, %v", identity, err)
	}

	boardStore := boards.NewStore(db)
	bucket, err := boardStore.CreateBucket(ctx, owner.ID, boards.CreateBucketInput{Name: "Private list"})
	if err != nil {
		t.Fatal(err)
	}
	taskA, err := boardStore.CreateTask(ctx, owner.ID, bucket.ID, boards.CreateTaskInput{Title: "Agent A task", AssigneeAgentID: agentA.ID})
	if err != nil {
		t.Fatal(err)
	}
	ready := boards.StatusQueued
	taskA, err = boardStore.UpdateTaskForHuman(ctx, owner.ID, taskA.ID, boards.UpdateTaskInput{Status: &ready})
	if err != nil {
		t.Fatal(err)
	}
	taskB, err := boardStore.CreateTask(ctx, owner.ID, bucket.ID, boards.CreateTaskInput{Title: "Agent B secret", AssigneeAgentID: agentB.ID})
	if err != nil {
		t.Fatal(err)
	}
	otherList, err := boardStore.CreateBucket(ctx, owner.ID, boards.CreateBucketInput{Name: "Agent B list"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := boardStore.CreateTask(ctx, owner.ID, otherList.ID, boards.CreateTaskInput{Title: "Agent B other work", AssigneeAgentID: agentB.ID}); err != nil {
		t.Fatal(err)
	}
	unrelatedList, err := boardStore.CreateBucket(ctx, owner.ID, boards.CreateBucketInput{Name: "Unrelated list"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := boardStore.CreateTask(ctx, owner.ID, unrelatedList.ID, boards.CreateTaskInput{Title: "Agent B unrelated work", AssigneeAgentID: agentB.ID}); err != nil {
		t.Fatal(err)
	}
	otherOwner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-route-other-%d@slate.test", time.Now().UnixNano()), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", otherOwner.ID) })
	otherBucket, err := boardStore.CreateBucket(ctx, otherOwner.ID, boards.CreateBucketInput{Name: "Other account list"})
	if err != nil {
		t.Fatal(err)
	}

	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("app")}}, db, false, auth.Options{}).Routes()

	list := agentRequest(t, app, agentAToken, http.MethodGet, "/api/v1/tasks", "")
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), taskA.ID) || strings.Contains(list.Body.String(), taskB.ID) || strings.Contains(list.Body.String(), taskB.Title) {
		t.Fatalf("scoped task list = %d %s", list.Code, list.Body.String())
	}
	ownGet := agentRequest(t, app, agentAToken, http.MethodGet, "/api/v1/tasks/"+taskA.ID, "")
	if ownGet.Code != http.StatusOK || !strings.Contains(ownGet.Body.String(), taskA.ID) {
		t.Fatalf("own task get = %d %s", ownGet.Code, ownGet.Body.String())
	}
	siblingGet := agentRequest(t, app, agentAToken, http.MethodGet, "/api/v1/tasks/"+taskB.ID, "")
	if siblingGet.Code != http.StatusNotFound || strings.Contains(siblingGet.Body.String(), taskB.Title) {
		t.Fatalf("sibling task get = %d %s", siblingGet.Code, siblingGet.Body.String())
	}
	siblingUpdate := agentRequest(t, app, agentAToken, http.MethodPatch, "/api/v1/tasks/"+taskB.ID, `{"title":"stolen"}`)
	if siblingUpdate.Code != http.StatusNotFound {
		t.Fatalf("sibling task update = %d %s", siblingUpdate.Code, siblingUpdate.Body.String())
	}

	// The list index is account-wide, so an agent must not be able to read it.
	listIndex := agentRequest(t, app, agentAToken, http.MethodGet, "/api/v1/lists", "")
	if listIndex.Code != http.StatusForbidden {
		t.Fatalf("agent list index = %d %s, want 403", listIndex.Code, listIndex.Body.String())
	}
	listGet := agentRequest(t, app, agentAToken, http.MethodGet, "/api/v1/lists/"+bucket.ID, "")
	if listGet.Code != http.StatusOK || !strings.Contains(listGet.Body.String(), bucket.ID) || !strings.Contains(listGet.Body.String(), `"openCount":1`) || strings.Contains(listGet.Body.String(), `"tasks"`) || strings.Contains(listGet.Body.String(), taskA.ID) || strings.Contains(listGet.Body.String(), taskB.Title) {
		t.Fatalf("scoped list get = %d %s", listGet.Code, listGet.Body.String())
	}
	for _, path := range []string{
		"/api/v1/lists/" + unrelatedList.ID,
		"/api/v1/lists/" + otherBucket.ID,
	} {
		recorder := agentRequest(t, app, agentAToken, http.MethodGet, path, "")
		if recorder.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d %s, want 404", path, recorder.Code, recorder.Body.String())
		}
	}

	restricted := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPost, "/api/v1/lists", `{"name":"Injected"}`},
		{http.MethodPost, "/api/v1/lists/reorder", `{"ids":[]}`},
		{http.MethodPatch, "/api/v1/lists/" + bucket.ID, `{"name":"Changed"}`},
		{http.MethodDelete, "/api/v1/lists/" + bucket.ID, ""},
		{http.MethodPost, "/api/v1/lists/" + bucket.ID + "/tasks", `{"title":"Injected"}`},
		{http.MethodPost, "/api/v1/lists/" + bucket.ID + "/reorder-tasks", `{"ids":[]}`},
		{http.MethodGet, "/api/v1/tasks/" + taskB.ID + "/subtasks", ""},
		{http.MethodPost, "/api/v1/tasks/" + taskB.ID + "/reorder-subtasks", `{"ids":[]}`},
		{http.MethodPost, "/api/v1/tasks/" + taskB.ID + "/move", fmt.Sprintf(`{"bucketId":%q,"position":0}`, bucket.ID)},
		{http.MethodDelete, "/api/v1/tasks/" + taskB.ID, ""},
		{http.MethodPatch, "/api/v1/tasks/" + taskA.ID, fmt.Sprintf(`{"bucketId":%q}`, otherList.ID)},
		{http.MethodPatch, "/api/v1/tasks/" + taskA.ID, `{"sortOrder":99}`},
		{http.MethodPatch, "/api/v1/tasks/" + taskA.ID, fmt.Sprintf(`{"assigneeAgentId":%q}`, agentB.ID)},
	}
	for _, request := range restricted {
		recorder := agentRequest(t, app, agentAToken, request.method, request.path, request.body)
		if recorder.Code != http.StatusForbidden {
			t.Errorf("%s %s = %d %s, want 403", request.method, request.path, recorder.Code, recorder.Body.String())
		}
	}
	permanentDelete := agentRequest(t, app, agentAToken, http.MethodDelete, "/api/v1/agents/"+agentA.ID, "")
	if permanentDelete.Code != http.StatusUnauthorized {
		t.Errorf("agent credential permanent delete = %d %s, want 401", permanentDelete.Code, permanentDelete.Body.String())
	}

	ownUpdate := agentRequest(t, app, agentAToken, http.MethodPatch, "/api/v1/tasks/"+taskA.ID, `{"description":"Agent A update"}`)
	if ownUpdate.Code != http.StatusOK || !strings.Contains(ownUpdate.Body.String(), "Agent A update") {
		t.Fatalf("own task update = %d %s", ownUpdate.Code, ownUpdate.Body.String())
	}
	pull := agentRequest(t, app, agentAToken, http.MethodGet, "/api/v1/agent/tasks", "")
	if pull.Code != http.StatusOK || !strings.Contains(pull.Body.String(), taskA.ID) || strings.Contains(pull.Body.String(), taskB.ID) {
		t.Fatalf("assigned task pull = %d %s", pull.Code, pull.Body.String())
	}
	claim := agentRequest(t, app, agentAToken, http.MethodPost, "/api/v1/agent/tasks/"+taskA.ID+"/claim", `{}`)
	if claim.Code != http.StatusOK || !strings.Contains(claim.Body.String(), `"status":"working"`) {
		t.Fatalf("assigned task claim = %d %s", claim.Code, claim.Body.String())
	}
	status := agentRequest(t, app, agentAToken, http.MethodPatch, "/api/v1/agent/tasks/"+taskA.ID+"/status", `{"status":"needs_review"}`)
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"status":"needs_review"`) {
		t.Fatalf("assigned task status = %d %s", status.Code, status.Body.String())
	}
	legacyDone := agentRequest(t, app, agentAToken, http.MethodPost, "/api/v1/agent/tasks/"+taskA.ID+"/done", "")
	if legacyDone.Code != http.StatusOK || !strings.Contains(legacyDone.Body.String(), `"status":"done"`) {
		t.Fatalf("legacy assigned task done = %d %s", legacyDone.Code, legacyDone.Body.String())
	}

	persistedSibling, err := boardStore.GetTask(ctx, owner.ID, taskB.ID)
	if err != nil || persistedSibling.Title != taskB.Title {
		t.Fatalf("sibling task after denied routes = %#v, error = %v", persistedSibling, err)
	}
	persistedOwn, err := boardStore.GetTask(ctx, owner.ID, taskA.ID)
	if err != nil || persistedOwn.BucketID != bucket.ID || persistedOwn.SortOrder != taskA.SortOrder || persistedOwn.AssigneeAgentID != agentA.ID {
		t.Fatalf("own task after denied routing fields = %#v, error = %v", persistedOwn, err)
	}
	persistedBucket, err := boardStore.GetBucket(ctx, owner.ID, bucket.ID)
	if err != nil || persistedBucket.Name != bucket.Name {
		t.Fatalf("list after denied routes = %#v, error = %v", persistedBucket, err)
	}
}

func TestManagedAgentRunHTTPContract(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run server integration tests")
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
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("managed-agent-route-%d@slate.test", time.Now().UnixNano()), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", owner.ID) })
	token := fmt.Sprintf("slate_managed_agent_%d", time.Now().UnixNano())
	agent, err := authStore.CreateAgent(ctx, owner.ID, "Managed Agent", "Implements assigned tasks", testTokenHash(token), "slate_managed_agent")
	if err != nil {
		t.Fatal(err)
	}
	store := boards.NewStore(db)
	bucket, err := store.CreateBucket(ctx, owner.ID, boards.CreateBucketInput{Name: "Ready"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask(ctx, owner.ID, bucket.ID, boards.CreateTaskInput{Title: "Managed HTTP task", AssigneeAgentID: agent.ID})
	if err != nil {
		t.Fatal(err)
	}
	app := NewApp(fstest.MapFS{"index.html": {Data: []byte("app")}}, db, false, auth.Options{}).Routes()

	me := agentRequest(t, app, token, http.MethodGet, "/api/v1/me", "")
	if me.Code != http.StatusOK || !strings.Contains(me.Body.String(), `"agentPurpose":"Implements assigned tasks"`) || !strings.Contains(me.Body.String(), `"managedRuns":true`) {
		t.Fatalf("managed agent me = %d %s", me.Code, me.Body.String())
	}
	// The inbox is account-wide, so an agent reading it would see every other
	// agent's messages.
	inbox := agentRequest(t, app, token, http.MethodGet, "/api/v1/inbox", "")
	if inbox.Code != http.StatusForbidden {
		t.Fatalf("agent inbox read = %d %s, want 403", inbox.Code, inbox.Body.String())
	}
	runID := "33333333-3333-4333-8333-333333333333"
	claim := agentRequestWithHeaders(t, app, token, http.MethodPost, "/api/v1/agent/tasks/"+task.ID+"/claim", `{}`, map[string]string{"X-Slate-Run-ID": runID})
	if claim.Code != http.StatusOK || !strings.Contains(claim.Body.String(), `"status":"working"`) {
		t.Fatalf("managed claim = %d %s", claim.Code, claim.Body.String())
	}
	claimedTask := agentRequest(t, app, token, http.MethodGet, "/api/v1/tasks/"+task.ID, "")
	if claimedTask.Code != http.StatusOK || !strings.Contains(claimedTask.Body.String(), `"executionRunId":"`+runID+`"`) {
		t.Fatalf("managed task ownership = %d %s", claimedTask.Code, claimedTask.Body.String())
	}
	missingRun := agentRequestWithHeaders(t, app, token, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries", `{"kind":"comment","body":"missing run"}`, map[string]string{"Idempotency-Key": "missing-run"})
	if missingRun.Code != http.StatusConflict || !strings.Contains(missingRun.Body.String(), `"code":"managed_run_mismatch"`) {
		t.Fatalf("missing run comment = %d %s", missingRun.Code, missingRun.Body.String())
	}
	comment := agentRequestWithHeaders(t, app, token, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries", `{"kind":"comment","body":"working"}`, map[string]string{"Idempotency-Key": "managed-comment", "X-Slate-Run-ID": runID})
	if comment.Code != http.StatusCreated || !strings.Contains(comment.Body.String(), `"runId":"`+runID+`"`) {
		t.Fatalf("managed comment = %d %s", comment.Code, comment.Body.String())
	}
	currentEdit := agentRequestWithHeaders(t, app, token, http.MethodPatch, "/api/v1/tasks/"+task.ID, `{"title":"Current run edit"}`, map[string]string{"X-Slate-Run-ID": runID})
	if currentEdit.Code != http.StatusOK || !strings.Contains(currentEdit.Body.String(), `"title":"Current run edit"`) {
		t.Fatalf("current managed run edit = %d %s", currentEdit.Code, currentEdit.Body.String())
	}
	newerRunID := "44444444-4444-4444-8444-444444444444"
	if _, err := db.Exec(ctx, `UPDATE tasks SET execution_run_id = $1 WHERE id = $2`, newerRunID, task.ID); err != nil {
		t.Fatal(err)
	}
	staleEdit := agentRequestWithHeaders(t, app, token, http.MethodPatch, "/api/v1/tasks/"+task.ID, `{"title":"Stale run edit"}`, map[string]string{"X-Slate-Run-ID": runID})
	if staleEdit.Code != http.StatusConflict || !strings.Contains(staleEdit.Body.String(), `"code":"managed_run_mismatch"`) {
		t.Fatalf("stale managed run edit = %d %s", staleEdit.Code, staleEdit.Body.String())
	}
	var storedTitle string
	if err := db.QueryRow(ctx, `SELECT title FROM tasks WHERE id = $1`, task.ID).Scan(&storedTitle); err != nil {
		t.Fatal(err)
	}
	if storedTitle != "Current run edit" {
		t.Fatalf("title after stale managed run edit = %q", storedTitle)
	}
	if _, err := db.Exec(ctx, `UPDATE tasks SET execution_run_id = $1 WHERE id = $2`, runID, task.ID); err != nil {
		t.Fatal(err)
	}
	status := agentRequestWithHeaders(t, app, token, http.MethodPatch, "/api/v1/agent/tasks/"+task.ID+"/status", `{"status":"needs_review"}`, map[string]string{"X-Slate-Run-ID": runID})
	if status.Code != http.StatusConflict || !strings.Contains(status.Body.String(), `"code":"managed_run_status_locked"`) {
		t.Fatalf("managed status = %d %s", status.Code, status.Body.String())
	}
	output := agentRequestWithHeaders(t, app, token, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries", `{"kind":"output","body":"done"}`, map[string]string{"Idempotency-Key": "managed-output", "X-Slate-Run-ID": runID})
	if output.Code != http.StatusCreated || !strings.Contains(output.Body.String(), `"taskStatus":"needs_review"`) {
		t.Fatalf("managed output = %d %s", output.Code, output.Body.String())
	}
	entries := agentRequest(t, app, token, http.MethodGet, "/api/v1/tasks/"+task.ID+"/entries?runId="+runID, "")
	if entries.Code != http.StatusOK || strings.Count(entries.Body.String(), `"runId":"`+runID+`"`) != 2 {
		t.Fatalf("managed run entries = %d %s", entries.Code, entries.Body.String())
	}
	replay := agentRequestWithHeaders(t, app, token, http.MethodPost, "/api/v1/tasks/"+task.ID+"/entries", `{"kind":"output","body":"done"}`, map[string]string{"Idempotency-Key": "managed-output", "X-Slate-Run-ID": runID})
	if replay.Code != http.StatusCreated || replay.Body.String() != output.Body.String() {
		t.Fatalf("managed output replay = %d %s, want %s", replay.Code, replay.Body.String(), output.Body.String())
	}
}

func agentRequest(t *testing.T, handler http.Handler, token string, method string, path string, body string) *httptest.ResponseRecorder {
	return agentRequestWithHeaders(t, handler, token, method, path, body, nil)
}

func agentRequestWithHeaders(t *testing.T, handler http.Handler, token string, method string, path string, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func testTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
