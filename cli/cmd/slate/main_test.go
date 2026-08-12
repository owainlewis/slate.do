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
	for _, topic := range []string{"", "auth", "boards", "lists", "tasks"} {
		if strings.TrimSpace(helpText[topic]) == "" {
			t.Fatalf("missing help for %q", topic)
		}
	}
	for _, command := range []string{"boards get", "boards create", "boards update", "boards delete", "lists list", "lists get", "lists create", "lists update", "lists delete", "lists reorder", "tasks list", "tasks get", "tasks create", "tasks update", "tasks delete", "tasks reorder", "tasks pull", "tasks claim", "tasks status", "tasks entries", "tasks comment", "tasks output"} {
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

// recordedRequest captures what the CLI actually sent so tests can assert on
// headers, query parameters, and body without reaching a real server.
type recordedRequest struct {
	method  string
	uri     string
	headers http.Header
	body    map[string]any
}

func recordingServer(t *testing.T, status int, response string) (*httptest.Server, *[]recordedRequest) {
	t.Helper()
	var recorded []recordedRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entry := recordedRequest{method: r.Method, uri: r.URL.RequestURI(), headers: r.Header.Clone()}
		_ = json.NewDecoder(r.Body).Decode(&entry.body)
		recorded = append(recorded, entry)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(response))
	}))
	t.Cleanup(server.Close)
	return server, &recorded
}

const testRunID = "9f1d0a2c-8b3e-4c1a-9d5f-2e6b7c8a9d01"

func TestManagedMutationsSendTheRunHeader(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusOK, `{"id":"task-1"}`)
	c := client{baseURL: server.URL, token: "test", runID: testRunID, http: server.Client()}

	if err := tasksCmd(c, []string{"claim", "task-1"}); err != nil {
		t.Fatal(err)
	}
	if err := tasksCmd(c, []string{"comment", "task-1", "--body", "Blocked on a decision.", "--idempotency-key", "watch-run:task-1:blocked"}); err != nil {
		t.Fatal(err)
	}
	if err := tasksCmd(c, []string{"output", "task-1", "--body", "Done and verified.", "--idempotency-key", "watch-run:task-1:output"}); err != nil {
		t.Fatal(err)
	}
	if err := tasksCmd(c, []string{"status", "task-1", "needs_review"}); err != nil {
		t.Fatal(err)
	}
	if len(*recorded) != 4 {
		t.Fatalf("requests = %d, want 4", len(*recorded))
	}
	for index, request := range *recorded {
		if got := request.headers.Get("X-Slate-Run-ID"); got != testRunID {
			t.Errorf("request %d run header = %q, want %q", index, got, testRunID)
		}
	}
	comment := (*recorded)[1]
	if comment.uri != "/api/v1/tasks/task-1/entries" || comment.body["kind"] != "comment" || comment.body["body"] != "Blocked on a decision." {
		t.Fatalf("comment request = %+v", comment)
	}
	if got := comment.headers.Get("Idempotency-Key"); got != "watch-run:task-1:blocked" {
		t.Fatalf("comment idempotency key = %q", got)
	}
	output := (*recorded)[2]
	if output.body["kind"] != "output" {
		t.Fatalf("output kind = %v", output.body["kind"])
	}
	if got := output.headers.Get("Idempotency-Key"); got != "watch-run:task-1:output" {
		t.Fatalf("output idempotency key = %q", got)
	}
}

func TestMutationsOmitTheRunHeaderWithoutAManagedRun(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusOK, `{"id":"task-1"}`)
	c := client{baseURL: server.URL, token: "test", http: server.Client()}

	if err := tasksCmd(c, []string{"claim", "task-1"}); err != nil {
		t.Fatal(err)
	}
	if _, present := (*recorded)[0].headers["X-Slate-Run-Id"]; present {
		t.Fatalf("legacy claim sent a run header: %v", (*recorded)[0].headers)
	}
}

func TestEntriesFiltersByExactRun(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusOK, `{"entries":[]}`)
	c := client{baseURL: server.URL, token: "test", runID: testRunID, http: server.Client()}

	if err := tasksCmd(c, []string{"entries", "task-1"}); err != nil {
		t.Fatal(err)
	}
	if err := tasksCmd(c, []string{"entries", "task-1", "--run", testRunID}); err != nil {
		t.Fatal(err)
	}
	if (*recorded)[0].uri != "/api/v1/tasks/task-1/entries" {
		t.Fatalf("unfiltered entries = %q", (*recorded)[0].uri)
	}
	if (*recorded)[1].uri != "/api/v1/tasks/task-1/entries?runId="+testRunID {
		t.Fatalf("filtered entries = %q", (*recorded)[1].uri)
	}
	if err := tasksCmd(c, []string{"entries", "task-1", "--run", "not-a-run"}); err == nil {
		t.Fatal("entries accepted an invalid run ID")
	}
	if len(*recorded) != 2 {
		t.Fatalf("requests = %d, want the invalid run to fail locally", len(*recorded))
	}
}

func TestEntryBodySourcesAreValidatedLocally(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusCreated, `{"id":"entry-1"}`)
	c := client{baseURL: server.URL, token: "test", http: server.Client()}

	cases := []struct {
		name string
		args []string
	}{
		{"no body source", []string{"output", "task-1", "--idempotency-key", "k"}},
		{"both body sources", []string{"output", "task-1", "--body", "text", "--file", "-", "--idempotency-key", "k"}},
		{"empty body", []string{"output", "task-1", "--body", "   ", "--idempotency-key", "k"}},
		{"oversized body", []string{"output", "task-1", "--body", strings.Repeat("a", cardEntryBytes+1), "--idempotency-key", "k"}},
		{"missing idempotency key", []string{"output", "task-1", "--body", "text"}},
		{"missing task id", []string{"output"}},
	}
	for _, test := range cases {
		if err := tasksCmd(c, test.args); err == nil {
			t.Errorf("%s was accepted", test.name)
		}
	}
	if len(*recorded) != 0 {
		t.Fatalf("invalid entries reached the server: %d requests", len(*recorded))
	}

	exact := []string{"output", "task-1", "--body", strings.Repeat("a", cardEntryBytes), "--idempotency-key", "k"}
	if err := tasksCmd(c, exact); err != nil {
		t.Fatalf("body at the limit was rejected: %v", err)
	}
}

func TestEntryBodyCanComeFromAFileOrStdin(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusCreated, `{"id":"entry-1"}`)
	c := client{baseURL: server.URL, token: "test", http: server.Client()}

	path := t.TempDir() + "/report.md"
	if err := os.WriteFile(path, []byte("Report from a file."), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := tasksCmd(c, []string{"output", "task-1", "--file", path, "--idempotency-key", "k"}); err != nil {
		t.Fatal(err)
	}
	if (*recorded)[0].body["body"] != "Report from a file." {
		t.Fatalf("file body = %v", (*recorded)[0].body["body"])
	}

	stdin, err := os.CreateTemp(t.TempDir(), "stdin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := stdin.WriteString("Report from stdin."); err != nil {
		t.Fatal(err)
	}
	if _, err := stdin.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	original := os.Stdin
	os.Stdin = stdin
	defer func() { os.Stdin = original }()
	if err := tasksCmd(c, []string{"comment", "task-1", "--file", "-", "--idempotency-key", "k"}); err != nil {
		t.Fatal(err)
	}
	if (*recorded)[1].body["body"] != "Report from stdin." {
		t.Fatalf("stdin body = %v", (*recorded)[1].body["body"])
	}
}

func TestRetryingAnOutputReusesTheSameKey(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusCreated, `{"id":"entry-1"}`)
	c := client{baseURL: server.URL, token: "test", runID: testRunID, http: server.Client()}

	args := []string{"output", "task-1", "--body", "Done.", "--idempotency-key", "watch-run:task-1:" + testRunID + ":output"}
	for attempt := 0; attempt < 2; attempt++ {
		if err := tasksCmd(c, args); err != nil {
			t.Fatal(err)
		}
	}
	first := (*recorded)[0].headers.Get("Idempotency-Key")
	second := (*recorded)[1].headers.Get("Idempotency-Key")
	if first == "" || first != second {
		t.Fatalf("idempotency keys = %q and %q, want one stable value", first, second)
	}
}

func TestStructuredErrorsKeepStatusCodeAndRetryAfter(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/status"):
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"code":"managed_run_status_locked","error":"a managed agent run changes status through claim and output"}`))
		default:
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "42")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"code":"rate_limit_exceeded","error":"Too many requests. Retry later."}`))
		}
	}))
	defer server.Close()
	c := client{baseURL: server.URL, token: "super-secret-token", runID: testRunID, http: server.Client()}

	err := tasksCmd(c, []string{"status", "task-1", "needs_review"})
	var locked *APIError
	if !errors.As(err, &locked) {
		t.Fatalf("status error = %v, want an APIError", err)
	}
	if locked.Status != http.StatusConflict || locked.Code != "managed_run_status_locked" {
		t.Fatalf("status error = %+v", locked)
	}
	if !strings.Contains(locked.Error(), "managed_run_status_locked") {
		t.Fatalf("status error text = %q", locked.Error())
	}

	err = tasksCmd(c, []string{"claim", "task-1"})
	var limited *APIError
	if !errors.As(err, &limited) {
		t.Fatalf("claim error = %v, want an APIError", err)
	}
	if limited.Status != http.StatusTooManyRequests || limited.RetryAfter != "42" || limited.Code != "rate_limit_exceeded" {
		t.Fatalf("claim error = %+v", limited)
	}
	if !strings.Contains(limited.Error(), "retry after 42s") {
		t.Fatalf("claim error text = %q", limited.Error())
	}
	for _, text := range []string{locked.Error(), limited.Error()} {
		if strings.Contains(text, "super-secret-token") || strings.Contains(text, "Bearer") {
			t.Fatalf("error text leaked a credential: %q", text)
		}
	}
}

func TestAnInvalidRunIdentityFailsBeforeAnyRequest(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusOK, `{"id":"task-1"}`)
	t.Setenv("SLATE_API_TOKEN", "test")
	t.Setenv("SLATE_BASE_URL", server.URL)
	t.Setenv("SLATE_RUN_ID", "not-a-run")

	for _, args := range [][]string{
		{"slate", "tasks", "claim", "task-1"},
		{"slate", "tasks", "output", "task-1", "--body", "x", "--idempotency-key", "k"},
		{"slate", "tasks", "update", "task-1", "--title", "x"},
		{"slate", "boards", "list"},
	} {
		err := run(args)
		if err == nil || !strings.Contains(err.Error(), "SLATE_RUN_ID") {
			t.Errorf("%v = %v, want an SLATE_RUN_ID validation failure", args[1:], err)
		}
	}
	if len(*recorded) != 0 {
		t.Fatalf("an invalid run identity reached the server: %d requests", len(*recorded))
	}
}

func TestTaskEditsCarryTheRunHeader(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusOK, `{"id":"task-1"}`)
	c := client{baseURL: server.URL, token: "test", runID: testRunID, http: server.Client()}

	// The server fences this route, so a managed run that cannot identify
	// itself here cannot edit the task it just claimed.
	if err := tasksCmd(c, []string{"update", "task-1", "--description", "Progress so far."}); err != nil {
		t.Fatal(err)
	}
	if got := (*recorded)[0].headers.Get("X-Slate-Run-ID"); got != testRunID {
		t.Fatalf("update run header = %q, want %q", got, testRunID)
	}
	if (*recorded)[0].body["description"] != "Progress so far." || len((*recorded)[0].body) != 1 {
		t.Fatalf("update body = %#v", (*recorded)[0].body)
	}
}

func TestABodyIsMeasuredTheWayTheServerMeasuresIt(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusCreated, `{"id":"entry-1"}`)
	c := client{baseURL: server.URL, token: "test", http: server.Client()}

	// A report of exactly the limit plus the trailing newline an editor writes
	// is within the limit once trimmed, which is what the server stores.
	body := strings.Repeat("a", cardEntryBytes) + "\n"
	if err := tasksCmd(c, []string{"output", "task-1", "--body", body, "--idempotency-key", "k"}); err != nil {
		t.Fatalf("body at the limit with a trailing newline was rejected: %v", err)
	}
	sent, _ := (*recorded)[0].body["body"].(string)
	if len(sent) != cardEntryBytes {
		t.Fatalf("sent body = %d bytes, want the trimmed %d", len(sent), cardEntryBytes)
	}
	if err := tasksCmd(c, []string{"output", "task-1", "--body", strings.Repeat("a", cardEntryBytes+1), "--idempotency-key", "k"}); err == nil {
		t.Fatal("a body over the limit was accepted")
	}
}

// TestLocalOutputSurvivesABrokenEnvironment covers every form that answers
// without a request. A malformed value must not hide the help that explains it.
func TestLocalOutputSurvivesABrokenEnvironment(t *testing.T) {
	t.Setenv("SLATE_RUN_ID", "not-a-run")
	t.Setenv("SLATE_API_TOKEN", "")
	for _, args := range [][]string{
		{"slate"},
		{"slate", "version"},
		{"slate", "--version"},
		{"slate", "help"},
		{"slate", "-h"},
		{"slate", "help", "tasks"},
		{"slate", "tasks"},
		{"slate", "tasks", "--help"},
		{"slate", "tasks", "-h"},
		{"slate", "boards"},
		{"slate", "boards", "-h"},
		{"slate", "lists", "--help"},
		{"slate", "auth", "help"},
	} {
		if err := run(args); err != nil {
			t.Errorf("%v with an invalid SLATE_RUN_ID = %v, want the local output", args[1:], err)
		}
	}
}

func TestRetryAfterKeepsItsUnitOnlyWhenNumeric(t *testing.T) {
	seconds := &APIError{Status: http.StatusTooManyRequests, RetryAfter: "42"}
	if !strings.Contains(seconds.Error(), "retry after 42s") {
		t.Fatalf("numeric retry text = %q", seconds.Error())
	}
	date := &APIError{Status: http.StatusServiceUnavailable, RetryAfter: "Wed, 21 Oct 2015 07:28:00 GMT"}
	if strings.Contains(date.Error(), "GMT s") || strings.Contains(date.Error(), "GMTs") {
		t.Fatalf("date retry text = %q", date.Error())
	}
	if !strings.Contains(date.Error(), "retry after Wed, 21 Oct 2015 07:28:00 GMT)") {
		t.Fatalf("date retry text = %q", date.Error())
	}
}

// TestHelpListsEveryCommandThatSendsTheRunHeader keeps the one paragraph that
// explains run_conflict in step with the commands that can produce it.
func TestHelpListsEveryCommandThatSendsTheRunHeader(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusOK, `{"id":"task-1"}`)
	c := client{baseURL: server.URL, token: "test", runID: testRunID, http: server.Client()}
	commands := map[string][]string{
		"claim":   {"claim", "task-1"},
		"status":  {"status", "task-1", "needs_review"},
		"update":  {"update", "task-1", "--description", "x"},
		"comment": {"comment", "task-1", "--body", "x", "--idempotency-key", "k"},
		"output":  {"output", "task-1", "--body", "x", "--idempotency-key", "k"},
	}
	for name, args := range commands {
		before := len(*recorded)
		if err := tasksCmd(c, args); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got := (*recorded)[before].headers.Get("X-Slate-Run-ID"); got != testRunID {
			t.Fatalf("%s did not send the run header", name)
		}
		if !strings.Contains(helpText["tasks"], name) {
			t.Errorf("help does not name %q among the commands that identify their run", name)
		}
	}
	line := "claim, status, update, comment, and output identify"
	if !strings.Contains(helpText["tasks"], line) {
		t.Fatalf("help does not list every run-identifying command; want a line containing %q", line)
	}
}

func TestHelpDoesNotPromiseAnUnshippedCommand(t *testing.T) {
	joined := helpText[""] + helpText["auth"] + helpText["boards"] + helpText["lists"] + helpText["tasks"]
	if strings.Contains(joined, "slate watch") {
		t.Fatal("help documents a watch command this CLI does not implement")
	}
}

// endlessReader stands in for an unbounded stdin, such as a pipe from a command
// that never finishes writing.
type endlessReader struct{ read int }

func (e *endlessReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 'a'
	}
	e.read += len(p)
	if e.read > 64*1024*1024 {
		return 0, errors.New("the CLI buffered far more than the entry limit")
	}
	return len(p), nil
}

func TestABodySourceIsBoundedBeforeItIsBuffered(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusCreated, `{"id":"entry-1"}`)
	c := client{baseURL: server.URL, token: "test", http: server.Client()}

	// An unbounded stdin must be cut off, not read until memory runs out.
	endless := &endlessReader{}
	fs := newFlagSet("tasks output")
	body := fs.String("body", "", "")
	file := fs.String("file", "", "")
	if err := fs.Parse([]string{"--file", "-"}); err != nil {
		t.Fatal(err)
	}
	if _, err := entryText(fs, *body, *file, endless); err == nil {
		t.Fatal("an unbounded stdin was accepted")
	}
	if endless.read > cardEntryBytes+128*1024 {
		t.Fatalf("read %d bytes of content from an unbounded source, want it cut off near the limit", endless.read)
	}

	// A large file is refused without being buffered whole.
	path := t.TempDir() + "/huge.log"
	if err := os.WriteFile(path, bytes.Repeat([]byte("a"), 4*1024*1024), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := tasksCmd(c, []string{"output", "task-1", "--file", path, "--idempotency-key", "k"}); err == nil {
		t.Fatal("a multi-megabyte file was accepted")
	}
	if len(*recorded) != 0 {
		t.Fatalf("an oversized body reached the server: %d requests", len(*recorded))
	}

	// Endless whitespace is trimmed away rather than filling memory, and it
	// must not run forever either.
	spaces := &endlessSpaceReader{}
	fs2 := newFlagSet("tasks output")
	body2 := fs2.String("body", "", "")
	file2 := fs2.String("file", "", "")
	if err := fs2.Parse([]string{"--file", "-"}); err != nil {
		t.Fatal(err)
	}
	err := func() error { _, e := entryText(fs2, *body2, *file2, spaces); return e }()
	if err == nil {
		t.Fatal("an endless run of whitespace was accepted")
	}
	// The message must name what actually stopped it, not a body size the
	// caller never supplied.
	if !strings.Contains(err.Error(), "whitespace") {
		t.Fatalf("error = %v, want it to name the whitespace", err)
	}
}

// TestWhitespaceAroundABodyIsTrimmedNotCounted proves the local check accepts
// exactly what the server would store: the body after trimming, however much
// removable whitespace surrounds it.
func TestWhitespaceAroundABodyIsTrimmedNotCounted(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusCreated, `{"id":"entry-1"}`)
	c := client{baseURL: server.URL, token: "test", http: server.Client()}
	dir := t.TempDir()

	cases := []struct {
		name string
		raw  []byte
		sent string
	}{
		{"a tiny report buried in newlines", append([]byte("x"), bytes.Repeat([]byte("\n"), 21*1024)...), "x"},
		{"leading whitespace far past the limit", append(bytes.Repeat([]byte("\n"), 21*1024), []byte("x")...), "x"},
		{"a report at the limit with trailing newlines", append(bytes.Repeat([]byte("a"), cardEntryBytes), bytes.Repeat([]byte("\n"), 21*1024)...), strings.Repeat("a", cardEntryBytes)},
		{"interior whitespace is kept", []byte("  first\n\nsecond  "), "first\n\nsecond"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(dir, "report")
			if err := os.WriteFile(path, test.raw, 0o600); err != nil {
				t.Fatal(err)
			}
			before := len(*recorded)
			if err := tasksCmd(c, []string{"output", "task-1", "--file", path, "--idempotency-key", "k"}); err != nil {
				t.Fatalf("rejected a body the server would store: %v", err)
			}
			sent, _ := (*recorded)[before].body["body"].(string)
			if sent != test.sent {
				t.Fatalf("sent %q, want %q", sent, test.sent)
			}
		})
	}

	// One byte of content over the limit is still refused, whitespace or not.
	path := filepath.Join(dir, "over")
	over := append(bytes.Repeat([]byte("\n"), 100), bytes.Repeat([]byte("a"), cardEntryBytes+1)...)
	if err := os.WriteFile(path, over, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := tasksCmd(c, []string{"output", "task-1", "--file", path, "--idempotency-key", "k"}); err == nil {
		t.Fatal("a body over the limit was accepted")
	}
}

// endlessSpaceReader is an unbounded run of removable whitespace, which trims
// to nothing and so can never complete a body.
type endlessSpaceReader struct{ read int }

func (e *endlessSpaceReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = '\n'
	}
	e.read += len(p)
	if e.read > 64*1024*1024 {
		return 0, errors.New("the CLI read far past any sane amount of whitespace")
	}
	return len(p), nil
}

// TestTrimmingMatchesTheServerForUnicodeWhitespace pins the streaming trim to
// strings.TrimSpace, which the server applies before it measures and stores.
func TestTrimmingMatchesTheServerForUnicodeWhitespace(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusCreated, `{"id":"entry-1"}`)
	c := client{baseURL: server.URL, token: "test", http: server.Client()}
	dir := t.TempDir()

	// A non-breaking space is whitespace to strings.TrimSpace, so more than a
	// limit's worth of it around a tiny report must still trim to the report.
	padding := strings.Repeat(" ", 17*1024)
	raw := padding + "x" + padding
	path := filepath.Join(dir, "nbsp.md")
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := tasksCmd(c, []string{"output", "task-1", "--file", path, "--idempotency-key", "k"}); err != nil {
		t.Fatalf("rejected a body the server would trim and store: %v", err)
	}
	if sent, _ := (*recorded)[0].body["body"].(string); sent != "x" {
		t.Fatalf("sent %q, want the trimmed body", sent)
	}
	// The same value through --body already went through strings.TrimSpace, so
	// the two paths must agree.
	if err := tasksCmd(c, []string{"output", "task-1", "--body", raw, "--idempotency-key", "k"}); err != nil {
		t.Fatalf("--body rejected what --file accepted: %v", err)
	}
	if sent, _ := (*recorded)[1].body["body"].(string); sent != "x" {
		t.Fatalf("--body sent %q, want the trimmed body", sent)
	}
	// Multi-byte content still counts its real byte length.
	over := strings.Repeat("é", cardEntryBytes/2+1)
	if err := tasksCmd(c, []string{"output", "task-1", "--body", over, "--idempotency-key", "k"}); err == nil {
		t.Fatal("a multi-byte body over the limit was accepted")
	}
}

// TestAMissingKeyIsReportedBeforeTheBodyIsRead covers an invalid command whose
// body source may never finish, such as a terminal or a FIFO.
func TestAnInvalidCommandIsReportedBeforeTheBodyIsRead(t *testing.T) {
	server, recorded := recordingServer(t, http.StatusCreated, `{"id":"entry-1"}`)
	c := client{baseURL: server.URL, token: "test", http: server.Client()}

	blocked := &endlessReader{}
	original := os.Stdin
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	// A pipe nobody writes to stands in for an interactive terminal: reading it
	// would block for ever.
	os.Stdin = read
	defer func() { os.Stdin = original; write.Close(); read.Close() }()

	for _, test := range []struct {
		name   string
		client client
		args   []string
		expect string
	}{
		{"missing key", c, []string{"output", "task-1", "--file", "-"}, "--idempotency-key"},
		{"missing token", client{baseURL: server.URL, http: server.Client()}, []string{"output", "task-1", "--file", "-", "--idempotency-key", "k"}, "SLATE_API_TOKEN"},
		{"malformed run", client{baseURL: server.URL, token: "test", runID: "not-a-run", http: server.Client()}, []string{"output", "task-1", "--file", "-", "--idempotency-key", "k"}, "SLATE_RUN_ID"},
	} {
		done := make(chan error, 1)
		go func() { done <- tasksCmd(test.client, test.args) }()
		select {
		case err := <-done:
			if err == nil || !strings.Contains(err.Error(), test.expect) {
				t.Errorf("%s: error = %v, want %q", test.name, err, test.expect)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("%s: the command blocked reading a body instead of reporting the problem", test.name)
		}
	}
	if len(*recorded) != 0 {
		t.Fatalf("an invalid command reached the server: %d requests", len(*recorded))
	}
	_ = blocked
}
