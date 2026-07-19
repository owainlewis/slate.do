package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestVersion(t *testing.T) {
	var output bytes.Buffer
	if err := printVersion(nil, &output); err != nil {
		t.Fatal(err)
	}
	if got, want := output.String(), "{\"version\":\"dev\"}\n"; got != want {
		t.Fatalf("version output = %q, want %q", got, want)
	}
	if err := printVersion([]string{"extra"}, &output); err == nil {
		t.Fatal("version accepted an extra argument")
	}
}

func TestEnvFallback(t *testing.T) {
	t.Setenv("SLATE_BASE_URL", "")
	if got := env("SLATE_BASE_URL", defaultBaseURL); got != "https://slate.do" {
		t.Fatalf("env fallback = %q", got)
	}
}

func TestNoArgumentsShowsHelp(t *testing.T) {
	if err := run([]string{"slate"}); err != nil {
		t.Fatal(err)
	}
}

func TestHelpDocumentsEveryResource(t *testing.T) {
	if !strings.Contains(helpText[""], "slate version") {
		t.Fatal("help does not document version command")
	}
	for _, topic := range []string{"", "auth", "boards", "lists", "tasks"} {
		if strings.TrimSpace(helpText[topic]) == "" {
			t.Fatalf("missing help for %q", topic)
		}
	}
	for _, command := range []string{"boards get", "boards create", "boards update", "boards delete", "lists list", "lists get", "lists create", "lists update", "lists delete", "lists reorder", "tasks list", "tasks get", "tasks create", "tasks update", "tasks delete", "tasks reorder", "tasks pull", "tasks claim", "tasks status", "tasks done"} {
		joined := helpText["boards"] + helpText["lists"] + helpText["tasks"]
		if !strings.Contains(joined, command) {
			t.Errorf("help does not document %q", command)
		}
	}
}

func TestTasksPullNeedsNoOwner(t *testing.T) {
	var requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.RequestURI()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tasks":[]}`))
	}))
	defer server.Close()

	err := tasksCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{"pull"})
	if err != nil {
		t.Fatal(err)
	}
	if requestedPath != "/api/v1/agent/tasks" {
		t.Fatalf("requested %q, want /api/v1/agent/tasks", requestedPath)
	}
}

func TestTasksCreateSendsTitleAndDescription(t *testing.T) {
	var body map[string]any
	var decodeErr error
	var idempotencyKey string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decodeErr = json.NewDecoder(r.Body).Decode(&body)
		idempotencyKey = r.Header.Get("Idempotency-Key")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-1"}`))
	}))
	defer server.Close()

	err := tasksCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{
		"create", "--list", "list-1", "--title", "Review positioning", "--description", "Compare options", "--date", "2026-07-13", "--idempotency-key", "review-positioning-v1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if body["title"] != "Review positioning" || body["description"] != "Compare options" || body["scheduledDate"] != "2026-07-13" || body["kind"] != "action" {
		t.Fatalf("body = %#v", body)
	}
	if _, exists := body["agent"]; exists {
		t.Fatalf("body contains ownership field: %#v", body)
	}
	if idempotencyKey != "review-positioning-v1" {
		t.Fatalf("Idempotency-Key = %q", idempotencyKey)
	}
}

func TestTasksUpdateCanClearDate(t *testing.T) {
	var body map[string]any
	var decodeErr error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decodeErr = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-1"}`))
	}))
	defer server.Close()

	err := tasksCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{"update", "task-1", "--date", ""})
	if err != nil {
		t.Fatal(err)
	}
	if decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if value, exists := body["scheduledDate"]; !exists || value != "" {
		t.Fatalf("body = %#v, want empty scheduledDate", body)
	}
}

func TestTasksWorkingStatusUsesAtomicClaimEndpoint(t *testing.T) {
	var method string
	var requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method = r.Method
		requestedPath = r.URL.RequestURI()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"working"}`))
	}))
	defer server.Close()

	err := tasksCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{"status", "task-1", "working"})
	if err != nil {
		t.Fatal(err)
	}
	if method != http.MethodPost || requestedPath != "/api/v1/agent/tasks/task-1/claim" {
		t.Fatalf("requested %s %q, want POST /api/v1/agent/tasks/task-1/claim", method, requestedPath)
	}
}

func TestTasksListSendsAllFilters(t *testing.T) {
	var requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.RequestURI()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tasks":[]}`))
	}))
	defer server.Close()

	err := tasksCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{
		"list", "--board", "board-1", "--list", "list-1", "--status", "queued", "--done", "false", "--limit", "12",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"boardId=board-1", "bucketId=list-1", "done=false", "limit=12", "status=queued"} {
		if !strings.Contains(requestedPath, value) {
			t.Fatalf("requested %q, missing %q", requestedPath, value)
		}
	}
}

func TestListsGetUsesBucketEndpoint(t *testing.T) {
	var method, requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, requestedPath = r.Method, r.URL.RequestURI()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"list-1","tasks":[]}`))
	}))
	defer server.Close()

	if err := listsCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{"get", "list-1"}); err != nil {
		t.Fatal(err)
	}
	if method != http.MethodGet || requestedPath != "/api/v1/buckets/list-1" {
		t.Fatalf("requested %s %q", method, requestedPath)
	}
}

func TestListsUpdateCanClearInbox(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"list-1","isInbox":false}`))
	}))
	defer server.Close()

	if err := listsCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{"update", "list-1", "--inbox=false"}); err != nil {
		t.Fatal(err)
	}
	if value, exists := body["isInbox"]; !exists || value != false {
		t.Fatalf("body = %#v", body)
	}
}

func TestBoardsCreateSendsConfiguration(t *testing.T) {
	var method string
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method = r.Method
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"board-1"}`))
	}))
	defer server.Close()

	err := boardsCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{
		"create", "--name", "Work", "--background-kind", "color", "--background-value", "blue", "--max-tasks-per-list", "8",
	})
	if err != nil {
		t.Fatal(err)
	}
	if method != http.MethodPost || body["name"] != "Work" || body["maxTasksPerList"] != float64(8) {
		t.Fatalf("method = %s, body = %#v", method, body)
	}
}

func TestTasksUpdateListAliasDoesNotLeakUnknownFields(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-1"}`))
	}))
	defer server.Close()

	err := tasksCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{"update", "task-1", "--list", "list-2"})
	if err != nil {
		t.Fatal(err)
	}
	if body["bucketId"] != "list-2" || len(body) != 1 {
		t.Fatalf("body = %#v", body)
	}
}

func TestInvalidStatusFailsBeforeRequest(t *testing.T) {
	err := tasksCmd(client{baseURL: "https://example.invalid", token: "test", http: http.DefaultClient}, []string{"status", "task-1", "blocked"})
	if err == nil || !strings.Contains(err.Error(), "invalid status") {
		t.Fatalf("error = %v", err)
	}
}
