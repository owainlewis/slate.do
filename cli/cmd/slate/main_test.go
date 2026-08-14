package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
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
	for _, topic := range []string{"", "auth", "boards", "lists", "tasks", "watch", "runs"} {
		if strings.TrimSpace(helpText[topic]) == "" {
			t.Fatalf("missing help for %q", topic)
		}
	}
	for _, command := range []string{"boards get", "boards create", "boards update", "boards delete", "lists list", "lists get", "lists create", "lists update", "lists delete", "lists reorder", "tasks list", "tasks get", "tasks create", "tasks update", "tasks delete", "tasks reorder", "tasks pull", "tasks claim", "tasks entries", "tasks comment", "tasks output", "tasks status"} {
		joined := helpText["boards"] + helpText["lists"] + helpText["tasks"]
		if !strings.Contains(joined, command) {
			t.Errorf("help does not document %q", command)
		}
	}
	for _, statement := range []string{
		"exit before ever claiming are deleted",
		"at most 10 retained worktrees",
		"slate runs clean <run-id>",
	} {
		joined := helpText["watch"] + helpText["runs"]
		if !strings.Contains(joined, statement) {
			t.Errorf("watcher help does not document %q", statement)
		}
	}
}

func TestManagedTaskCommandsSendRunHeadersAndExactRunQuery(t *testing.T) {
	t.Setenv("SLATE_RUN_ID", "11111111-1111-4111-8111-111111111111")
	type requestRecord struct {
		method         string
		uri            string
		runID          string
		idempotencyKey string
		body           map[string]any
	}
	var requests []requestRecord
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		record := requestRecord{
			method:         r.Method,
			uri:            r.URL.RequestURI(),
			runID:          r.Header.Get("X-Slate-Run-ID"),
			idempotencyKey: r.Header.Get("Idempotency-Key"),
		}
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&record.body)
		}
		requests = append(requests, record)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	c := client{baseURL: server.URL, token: "test", http: server.Client(), stdin: strings.NewReader("implemented from stdin")}

	commands := [][]string{
		{"claim", "task-1"},
		{"entries", "task-1", "--run", "11111111-1111-4111-8111-111111111111"},
		{"comment", "task-1", "--body", "blocked on review", "--idempotency-key", "comment-1"},
		{"output", "task-1", "--file", "-", "--idempotency-key", "output-1"},
		{"update", "task-1", "--title", "Managed edit"},
		{"status", "task-1", "needs_review"},
	}
	for _, command := range commands {
		if err := tasksCmd(c, command); err != nil {
			t.Fatalf("tasks %s: %v", strings.Join(command, " "), err)
		}
	}
	if len(requests) != len(commands) {
		t.Fatalf("request count = %d, want %d", len(requests), len(commands))
	}
	if requests[1].uri != "/api/v1/tasks/task-1/entries?runId=11111111-1111-4111-8111-111111111111" {
		t.Fatalf("entries URI = %q", requests[1].uri)
	}
	if requests[1].runID != "" {
		t.Fatalf("read-only entries request sent run header %q", requests[1].runID)
	}
	for _, index := range []int{0, 2, 3, 4, 5} {
		if requests[index].runID != "11111111-1111-4111-8111-111111111111" {
			t.Fatalf("request %d run ID = %q", index, requests[index].runID)
		}
	}
	if requests[2].idempotencyKey != "comment-1" || requests[2].body["kind"] != "comment" || requests[2].body["body"] != "blocked on review" {
		t.Fatalf("comment request = %#v", requests[2])
	}
	if requests[3].idempotencyKey != "output-1" || requests[3].body["kind"] != "output" || requests[3].body["body"] != "implemented from stdin" {
		t.Fatalf("output request = %#v", requests[3])
	}
}

func TestTaskEntryBodySourcesAndLimitsFailLocally(t *testing.T) {
	t.Setenv("SLATE_RUN_ID", "")
	requested := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	emptyFile := filepath.Join(t.TempDir(), "empty.txt")
	if err := os.WriteFile(emptyFile, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	oversizedFile := filepath.Join(t.TempDir(), "oversized.txt")
	if err := os.WriteFile(oversizedFile, []byte(strings.Repeat("x", maxTaskEntryBodyBytes+1)), 0o600); err != nil {
		t.Fatal(err)
	}
	c := client{baseURL: server.URL, token: "test", http: server.Client(), stdin: strings.NewReader("")}

	invalid := [][]string{
		{"comment", "task-1"},
		{"comment", "task-1", "--body", "one", "--file", "two"},
		{"comment", "task-1", "--body", " \n\t"},
		{"comment", "task-1", "--file", emptyFile},
		{"comment", "task-1", "--file", oversizedFile},
		{"comment", "task-1", "--file", "-"},
		{"output", "task-1", "--body", "done"},
		{"output", "task-1", "--body", "", "--idempotency-key", "empty-output"},
		{"comment", "task-1", "--body", strings.Repeat("x", maxTaskEntryBodyBytes+1)},
	}
	for _, command := range invalid {
		if err := tasksCmd(c, command); err == nil {
			t.Fatalf("tasks %s unexpectedly succeeded", strings.Join(command, " "))
		}
	}
	t.Setenv("SLATE_RUN_ID", "11111111-1111-4111-8111-111111111111")
	if err := tasksCmd(c, []string{"comment", "task-1", "--body", "managed"}); err == nil || !strings.Contains(err.Error(), "idempotency") {
		t.Fatalf("managed comment error = %v", err)
	}
	if requested != 0 {
		t.Fatalf("invalid commands sent %d requests", requested)
	}
}

func TestTaskCommentReadsAFile(t *testing.T) {
	t.Setenv("SLATE_RUN_ID", "")
	path := filepath.Join(t.TempDir(), "comment.txt")
	if err := os.WriteFile(path, []byte("file comment"), 0o600); err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	c := client{baseURL: server.URL, token: "test", http: server.Client()}
	if err := tasksCmd(c, []string{"comment", "task-1", "--file", path}); err != nil {
		t.Fatal(err)
	}
	if body["body"] != "file comment" {
		t.Fatalf("body = %#v", body)
	}
}

func TestOutputRetryReusesCallerIdempotencyKey(t *testing.T) {
	t.Setenv("SLATE_RUN_ID", "11111111-1111-4111-8111-111111111111")
	var keys []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		keys = append(keys, r.Header.Get("Idempotency-Key"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"entry-1"}`))
	}))
	defer server.Close()
	c := client{baseURL: server.URL, token: "test", http: server.Client()}
	command := []string{"output", "task-1", "--body", "done", "--idempotency-key", "stable-output-key"}
	if err := tasksCmd(c, command); err != nil {
		t.Fatal(err)
	}
	if err := tasksCmd(c, command); err != nil {
		t.Fatal(err)
	}
	if want := []string{"stable-output-key", "stable-output-key"}; !reflect.DeepEqual(keys, want) {
		t.Fatalf("idempotency keys = %#v, want %#v", keys, want)
	}
}

func TestAPIErrorPreservesStructureRetryAfterAndRedactsToken(t *testing.T) {
	const token = "slate_secret_token"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "17")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"code":"rate_limited","error":"retry","echo":"` + token + `"}`))
	}))
	defer server.Close()
	c := client{baseURL: server.URL, token: token, http: server.Client()}
	err := c.do(http.MethodGet, "/api/v1/me", nil, nil)
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("error = %T %v", err, err)
	}
	if apiErr.StatusCode != http.StatusTooManyRequests || apiErr.Code != "rate_limited" || apiErr.RetryAfter != "17" || apiErr.RetryAfterDuration != 17*time.Second {
		t.Fatalf("structured error = %#v", apiErr)
	}
	if strings.Contains(apiErr.Body, token) || strings.Contains(apiErr.Error(), token) {
		t.Fatalf("error exposed bearer token: %#v", apiErr)
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

func TestTasksCreateUsesInboxWithoutAListAndCanCreateASubtask(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-1"}`))
	}))
	defer server.Close()
	c := client{baseURL: server.URL, token: "test", http: server.Client()}

	if err := tasksCmd(c, []string{"create", "--title", "Captured thought"}); err != nil {
		t.Fatal(err)
	}
	if err := tasksCmd(c, []string{"create", "--parent", "parent-1", "--title", "Human review"}); err != nil {
		t.Fatal(err)
	}
	if want := []string{"/api/v1/tasks", "/api/v1/tasks/parent-1/subtasks"}; !reflect.DeepEqual(paths, want) {
		t.Fatalf("paths = %#v, want %#v", paths, want)
	}
	if err := tasksCmd(c, []string{"create", "--list", "list-1", "--parent", "parent-1", "--title", "Invalid"}); err == nil {
		t.Fatal("expected --list and --parent conflict")
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
	t.Setenv("SLATE_RUN_ID", "")
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

func TestManagedWorkingStatusUsesStatusEndpointAndPreservesCodedError(t *testing.T) {
	t.Setenv("SLATE_RUN_ID", "11111111-1111-4111-8111-111111111111")
	var method, requestedPath, runID string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, requestedPath, runID = r.Method, r.URL.RequestURI(), r.Header.Get("X-Slate-Run-ID")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"code":"managed_run_status_locked","error":"managed run status is controlled by output"}`))
	}))
	defer server.Close()

	err := tasksCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{"status", "task-1", "working"})
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Code != "managed_run_status_locked" || apiErr.StatusCode != http.StatusConflict {
		t.Fatalf("managed working error = %T %#v", err, err)
	}
	if method != http.MethodPatch || requestedPath != "/api/v1/agent/tasks/task-1/status" || runID != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("requested %s %q with run %q", method, requestedPath, runID)
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
		"list", "--board", "board-1", "--list", "list-1", "--status", "done", "--limit", "12", "--cursor", "next-page",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"boardId=board-1", "bucketId=list-1", "cursor=next-page", "limit=12", "status=done"} {
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
	if !validStatus("new") {
		t.Fatal("new should be a valid status")
	}
	err := tasksCmd(client{baseURL: "https://example.invalid", token: "test", http: http.DefaultClient}, []string{"status", "task-1", "blocked"})
	if err == nil || !strings.Contains(err.Error(), "invalid status") {
		t.Fatalf("error = %v", err)
	}
}
