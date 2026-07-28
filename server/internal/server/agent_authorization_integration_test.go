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

	boardStore := boards.NewStore(db)
	board, err := boardStore.CreateBoard(ctx, owner.ID, boards.CreateBoardInput{Name: "Private board"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := boardStore.CreateBucket(ctx, owner.ID, board.ID, boards.CreateBucketInput{Name: "Private list"})
	if err != nil {
		t.Fatal(err)
	}
	taskA, err := boardStore.CreateTask(ctx, owner.ID, bucket.ID, boards.CreateTaskInput{Title: "Agent A task", AssigneeAgentID: agentA.ID})
	if err != nil {
		t.Fatal(err)
	}
	taskB, err := boardStore.CreateTask(ctx, owner.ID, bucket.ID, boards.CreateTaskInput{Title: "Agent B secret", AssigneeAgentID: agentB.ID})
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

	restricted := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/v1/boards", ""},
		{http.MethodPost, "/api/v1/boards", `{"name":"Injected"}`},
		{http.MethodGet, "/api/v1/boards/" + board.ID, ""},
		{http.MethodPatch, "/api/v1/boards/" + board.ID, `{"name":"Changed"}`},
		{http.MethodDelete, "/api/v1/boards/" + board.ID, ""},
		{http.MethodPost, "/api/v1/boards/" + board.ID + "/buckets", `{"name":"Injected"}`},
		{http.MethodPost, "/api/v1/boards/" + board.ID + "/reorder-buckets", `{"ids":[]}`},
		{http.MethodGet, "/api/v1/buckets/" + bucket.ID, ""},
		{http.MethodPatch, "/api/v1/buckets/" + bucket.ID, `{"name":"Changed"}`},
		{http.MethodDelete, "/api/v1/buckets/" + bucket.ID, ""},
		{http.MethodPost, "/api/v1/buckets/" + bucket.ID + "/tasks", `{"title":"Injected"}`},
		{http.MethodPost, "/api/v1/buckets/" + bucket.ID + "/reorder-tasks", `{"ids":[]}`},
		{http.MethodPost, "/api/v1/tasks/" + taskB.ID + "/move", fmt.Sprintf(`{"bucketId":%q,"position":0}`, bucket.ID)},
		{http.MethodDelete, "/api/v1/tasks/" + taskB.ID, ""},
	}
	for _, request := range restricted {
		recorder := agentRequest(t, app, agentAToken, request.method, request.path, request.body)
		if recorder.Code != http.StatusForbidden {
			t.Errorf("%s %s = %d %s, want 403", request.method, request.path, recorder.Code, recorder.Body.String())
		}
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

	persistedSibling, err := boardStore.GetTask(ctx, owner.ID, taskB.ID)
	if err != nil || persistedSibling.Title != taskB.Title {
		t.Fatalf("sibling task after denied routes = %#v, error = %v", persistedSibling, err)
	}
	persistedBoard, err := boardStore.GetBoard(ctx, owner.ID, board.ID)
	if err != nil || persistedBoard.Name != board.Name {
		t.Fatalf("board after denied routes = %#v, error = %v", persistedBoard, err)
	}
	persistedBucket, err := boardStore.GetBucket(ctx, owner.ID, bucket.ID)
	if err != nil || persistedBucket.Name != bucket.Name {
		t.Fatalf("list after denied routes = %#v, error = %v", persistedBucket, err)
	}
}

func agentRequest(t *testing.T, handler http.Handler, token string, method string, path string, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func testTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
