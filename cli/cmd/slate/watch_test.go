package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

const (
	testAgentID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
	testTaskID  = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"
)

// fakeSlate is a Slate server with just enough behavior to drive a watcher:
// one queue, one claim that only the first run wins, and run-tagged entries.
type fakeSlate struct {
	mu                sync.Mutex
	t                 *testing.T
	managedRuns       bool
	agentID           string
	purpose           string
	queued            []taskView
	status            string
	owningRun         string
	entries           []entryView
	claims            int
	seenRunIDs        []string
	seenTokens        []string
	workingTasks      []taskView
	workingAfterClaim bool
}

func newFakeSlate(t *testing.T) *fakeSlate {
	return &fakeSlate{
		t: t, managedRuns: true, agentID: testAgentID, purpose: "Implement assigned work",
		status: "queued",
		queued: []taskView{{
			ID: testTaskID, Title: "Add the thing", Status: "queued", Priority: "p1",
			BoardName: "Delivery", ListName: "Ready", AssigneeAgentID: testAgentID,
		}},
	}
}

func (f *fakeSlate) start() *httptest.Server {
	server := httptest.NewServer(http.HandlerFunc(f.serve))
	f.t.Cleanup(server.Close)
	return server
}

func (f *fakeSlate) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "); token != "" {
		f.seenTokens = append(f.seenTokens, token)
	}
	if runID := r.Header.Get("X-Slate-Run-ID"); runID != "" {
		f.seenRunIDs = append(f.seenRunIDs, runID)
	}
	w.Header().Set("Content-Type", "application/json")
	switch {
	case r.URL.Path == "/api/v1/me":
		_ = json.NewEncoder(w).Encode(map[string]any{
			"authenticated": true,
			"user":          map[string]any{"id": "owner", "agentId": f.agentID, "agentPurpose": f.purpose, "displayName": "Codex"},
			"capabilities":  map[string]any{"managedRuns": f.managedRuns},
		})
	case r.URL.Path == "/api/v1/agent/tasks":
		wanted := r.URL.Query().Get("status")
		tasks := []taskView{}
		if wanted == "working" {
			tasks = f.workingTasks
			if f.workingAfterClaim && f.claims > 0 {
				tasks = []taskView{{ID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", Title: "Started elsewhere"}}
			}
		} else if f.status == "queued" {
			tasks = f.queued
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"tasks": tasks})
	case strings.HasSuffix(r.URL.Path, "/claim"):
		f.claims++
		if f.status != "queued" {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"code":"task_unavailable","error":"task is not available"}`))
			return
		}
		f.status = "working"
		f.owningRun = r.Header.Get("X-Slate-Run-ID")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": testTaskID, "status": "working"})
	case strings.HasSuffix(r.URL.Path, "/entries") && r.Method == http.MethodGet:
		runFilter := r.URL.Query().Get("runId")
		matched := []entryView{}
		for _, entry := range f.entries {
			if runFilter == "" || strings.EqualFold(entry.RunID, runFilter) {
				matched = append(matched, entry)
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"entries": matched})
	case strings.HasSuffix(r.URL.Path, "/entries") && r.Method == http.MethodPost:
		var input struct{ Kind, Body string }
		_ = json.NewDecoder(r.Body).Decode(&input)
		runID := r.Header.Get("X-Slate-Run-ID")
		if runID != f.owningRun {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"code":"run_conflict","error":"this task belongs to a different agent run"}`))
			return
		}
		f.entries = append(f.entries, entryView{ID: fmt.Sprint(len(f.entries)), Kind: input.Kind, AuthorKind: "agent", RunID: runID})
		if input.Kind == "output" {
			f.status = "needs_review"
			f.owningRun = ""
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "entry", "kind": input.Kind})
	case strings.HasPrefix(r.URL.Path, "/api/v1/tasks/"):
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": testTaskID, "title": "Add the thing", "status": f.status,
			"assigneeAgentId": f.agentID, "executionRunId": f.owningRun,
		})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func (f *fakeSlate) snapshot() (status string, owningRun string, entries int, claims int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.status, f.owningRun, len(f.entries), f.claims
}

// newSourceRepository builds a real Git repository so worktree behavior is
// exercised rather than mocked.
func newSourceRepository(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, args := range [][]string{
		{"init", "--initial-branch=main"},
		{"config", "user.email", "watcher@slate.test"},
		{"config", "user.name", "Watcher Test"},
	} {
		command := exec.Command("git", args...)
		command.Dir = dir
		if out, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("source\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "-A"}, {"commit", "-m", "initial"}} {
		command := exec.Command("git", args...)
		command.Dir = dir
		if out, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	return dir
}

// writeExecutor creates a fake agent as a shell script, so the watcher's real
// process handling is exercised.
func writeExecutor(t *testing.T, name string, body string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, name)
	script := "#!/bin/sh\n" + body
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

// watcherFixture wires a profile, registry, cache, and source repository into
// isolated directories so nothing touches the developer's real state.
type watcherFixture struct {
	source   string
	server   *httptest.Server
	fake     *fakeSlate
	home     string
	profile  string
	executor string
}

func newWatcherFixture(t *testing.T, executorPath string) *watcherFixture {
	t.Helper()
	fake := newFakeSlate(t)
	server := fake.start()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_STATE_HOME", filepath.Join(home, "state"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, "cache"))
	t.Setenv("SLATE_CODEX_TOKEN", "slate_agent_secret_value")
	t.Setenv("SLATE_API_TOKEN", "")
	t.Setenv("SLATE_RUN_ID", "")
	t.Setenv("PATH", filepath.Dir(executorPath)+string(os.PathListSeparator)+os.Getenv("PATH"))

	configPath := filepath.Join(home, "config.json")
	config := fmt.Sprintf(`{"profiles":{"codex":{"agentId":%q,"tokenEnv":"SLATE_CODEX_TOKEN","command":[%q]}}}`,
		testAgentID, filepath.Base(executorPath))
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SLATE_CONFIG", configPath)

	return &watcherFixture{
		source: newSourceRepository(t), server: server, fake: fake,
		home: home, profile: "codex", executor: executorPath,
	}
}

func (f *watcherFixture) newWatcher(t *testing.T) (*watcher, error) {
	t.Helper()
	c := client{baseURL: f.server.URL, http: f.server.Client()}
	w, err := newWatcher(context.Background(), c, watchOptions{
		profileName: f.profile, workdir: f.source,
	}, &strings.Builder{})
	if err != nil {
		return nil, err
	}
	// Keep tests fast; the watcher's real intervals are covered by the
	// resilience work.
	w.sleep = func(ctx context.Context, d time.Duration) {}
	return w, nil
}

func (f *watcherFixture) runs(t *testing.T) []runRecord {
	t.Helper()
	registry, err := openRegistry()
	if err != nil {
		t.Fatal(err)
	}
	records, err := registry.list("")
	if err != nil {
		t.Fatal(err)
	}
	return records
}

func TestAValidTaskLaunchesInItsOwnWorktreeWithTheRunEnvironment(t *testing.T) {
	// The executor records what it was given, then reports success the way a
	// real agent would.
	report := filepath.Join(t.TempDir(), "seen.txt")
	executor := writeExecutor(t, "fake-codex", fmt.Sprintf(`
prompt=$(cat)
{
  echo "cwd=$(pwd -P)"
  echo "run=$SLATE_RUN_ID"
  echo "bin=$SLATE_BIN"
  echo "base=$SLATE_BASE_URL"
  echo "token_present=$([ -n "$SLATE_API_TOKEN" ] && echo yes || echo no)"
  echo "path_head=$(echo "$PATH" | cut -d: -f1)"
  echo "prompt<<"
  echo "$prompt"
  echo ">>"
} > %s
"$SLATE_BIN" tasks claim %s >/dev/null || exit 1
"$SLATE_BIN" tasks output %s --body "Done." --idempotency-key "watch-run:%s:$SLATE_RUN_ID:output" >/dev/null
`, report, testTaskID, testTaskID, testTaskID))
	fixture := newWatcherFixture(t, executor)

	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	// The watcher must use this test's binary, not whatever is on PATH.
	w.slateBinary = buildTestSlateBinary(t)

	state, err := w.attempt(context.Background(), fixture.fake.queued[0])
	if err != nil {
		t.Fatal(err)
	}
	if state != runStateSuccess {
		t.Fatalf("state = %q, want success", state)
	}

	raw, err := os.ReadFile(report)
	if err != nil {
		t.Fatal(err)
	}
	seen := string(raw)
	records := fixture.runs(t)
	if len(records) != 1 {
		t.Fatalf("records = %d, want 1", len(records))
	}
	record := records[0]

	sourceReal, _ := filepath.EvalSymlinks(fixture.source)
	if strings.Contains(seen, "cwd="+sourceReal+"\n") {
		t.Fatalf("the executor ran in the source checkout:\n%s", seen)
	}
	worktreeReal, _ := filepath.EvalSymlinks(record.Worktree)
	if !strings.Contains(seen, "cwd="+worktreeReal+"\n") {
		t.Fatalf("executor working directory is not its worktree %s:\n%s", worktreeReal, seen)
	}
	if !strings.Contains(seen, "run="+record.RunID+"\n") {
		t.Fatalf("run ID was not passed:\n%s", seen)
	}
	if !strings.Contains(seen, "bin="+w.slateBinary+"\n") {
		t.Fatalf("SLATE_BIN is not the exact binary:\n%s", seen)
	}
	if !strings.Contains(seen, "path_head="+filepath.Dir(w.slateBinary)+"\n") {
		t.Fatalf("the binary directory was not prepended to PATH:\n%s", seen)
	}
	if !strings.Contains(seen, "token_present=yes") {
		t.Fatalf("the credential was not passed in the environment:\n%s", seen)
	}
	if strings.Contains(seen, "slate_agent_secret_value") && !strings.Contains(seen, "token_present=yes\n") {
		t.Fatalf("the credential leaked into the prompt:\n%s", seen)
	}
	promptStart := strings.Index(seen, "prompt<<")
	if promptStart < 0 || strings.Contains(seen[promptStart:], "slate_agent_secret_value") {
		t.Fatalf("the prompt contains the credential:\n%s", seen)
	}
	if strings.Contains(seen[promptStart:], sourceReal) {
		t.Fatalf("the prompt names the source checkout:\n%s", seen)
	}
	for _, expected := range []string{record.RunID, testTaskID, "tasks claim", "tasks output", "tasks entries"} {
		if !strings.Contains(seen[promptStart:], expected) {
			t.Fatalf("the prompt is missing %q:\n%s", expected, seen[promptStart:])
		}
	}

	status, _, entries, claims := fixture.fake.snapshot()
	if status != "needs_review" || entries != 1 || claims != 1 {
		t.Fatalf("server state = %s, %d entries, %d claims", status, entries, claims)
	}
	if record.State != runStateSuccess || record.Branch != runBranchName(testTaskID, record.RunID) {
		t.Fatalf("record = %+v", record)
	}
	if _, err := os.Stat(record.Worktree); err != nil {
		t.Fatalf("a successful worktree was not retained: %v", err)
	}
	for _, token := range fixture.fake.seenTokens {
		if token != "slate_agent_secret_value" {
			t.Fatalf("an unexpected credential reached the server: %q", token)
		}
	}
}

// buildTestSlateBinary compiles the CLI under test so a fake executor can call
// the real commands rather than a stub.
func buildTestSlateBinary(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "slate")
	command := exec.Command("go", "build", "-o", path, ".")
	if out, err := command.CombinedOutput(); err != nil {
		t.Fatalf("building the CLI: %v %s", err, out)
	}
	return path
}

func TestALostClaimRemovesItsWorktreeAndBranch(t *testing.T) {
	executor := writeExecutor(t, "losing-codex", `
cat >/dev/null
echo "changed" > pre-claim.txt
exit 1
`)
	fixture := newWatcherFixture(t, executor)
	// Another run already owns the task.
	fixture.fake.status = "working"
	fixture.fake.owningRun = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	state, err := w.attempt(context.Background(), taskView{ID: testTaskID, Title: "Add the thing"})
	if err != nil {
		t.Fatal(err)
	}
	// Another run already owns the task, so this is the ordinary losing race.
	if state != outcomeLostRace {
		t.Fatalf("state = %q, want a lost race", state)
	}
	if records := fixture.runs(t); len(records) != 0 {
		t.Fatalf("a losing run left %d records", len(records))
	}
	base, err := worktreeBase("codex")
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(base)
	if err == nil && len(entries) != 0 {
		t.Fatalf("a losing run left %d worktrees in %s", len(entries), base)
	}
	branches, err := runGit(context.Background(), fixture.source, "branch", "--list", "slate/*")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(branches) != "" {
		t.Fatalf("a losing run left branches: %q", branches)
	}
	// The source checkout is untouched.
	status, err := runGit(context.Background(), fixture.source, "status", "--porcelain")
	if err != nil || status != "" {
		t.Fatalf("source checkout changed: %q %v", status, err)
	}
}

func TestABlockedRunKeepsItsWorktreeAndStops(t *testing.T) {
	executor := writeExecutor(t, "blocked-codex", fmt.Sprintf(`
cat >/dev/null
"$SLATE_BIN" tasks claim %s >/dev/null || exit 1
"$SLATE_BIN" tasks comment %s --body "Blocked on a decision." --idempotency-key "blocked" >/dev/null
`, testTaskID, testTaskID))
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.slateBinary = buildTestSlateBinary(t)

	state, err := w.attempt(context.Background(), fixture.fake.queued[0])
	if err != nil {
		t.Fatal(err)
	}
	if state != runStateBlocked {
		t.Fatalf("state = %q, want blocked", state)
	}
	status, _, entries, _ := fixture.fake.snapshot()
	if status != "working" || entries != 1 {
		t.Fatalf("server state = %s with %d entries, want the task still in progress", status, entries)
	}
	records := fixture.runs(t)
	if len(records) != 1 || records[0].State != runStateBlocked {
		t.Fatalf("records = %+v", records)
	}
	if _, err := os.Stat(records[0].Worktree); err != nil {
		t.Fatalf("a blocked worktree was not retained: %v", err)
	}
}

func TestAnExecutorThatClaimsThenExitsIsInterrupted(t *testing.T) {
	executor := writeExecutor(t, "quitting-codex", fmt.Sprintf(`
cat >/dev/null
"$SLATE_BIN" tasks claim %s >/dev/null || exit 1
exit 0
`, testTaskID))
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.slateBinary = buildTestSlateBinary(t)

	state, err := w.attempt(context.Background(), fixture.fake.queued[0])
	if err != nil {
		t.Fatal(err)
	}
	if state != runStateInterrupted {
		t.Fatalf("state = %q, want interrupted", state)
	}
	status, _, entries, _ := fixture.fake.snapshot()
	if status != "working" || entries != 0 {
		t.Fatalf("server state = %s with %d entries, want the task still in progress and no entry", status, entries)
	}
	records := fixture.runs(t)
	if len(records) != 1 || records[0].State != runStateInterrupted {
		t.Fatalf("records = %+v", records)
	}
	if _, err := os.Stat(records[0].Worktree); err != nil {
		t.Fatalf("an interrupted worktree was not retained: %v", err)
	}
}

func TestDistinctRunsGetDistinctWorktrees(t *testing.T) {
	executor := writeExecutor(t, "noop-codex", "cat >/dev/null\nexit 1\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for attempt := 0; attempt < 3; attempt++ {
		runID, err := newRunID()
		if err != nil {
			t.Fatal(err)
		}
		path, branch, err := createRunWorktree(context.Background(), w.source, "codex", testTaskID, runID)
		if err != nil {
			t.Fatal(err)
		}
		if seen[path] || seen[branch] {
			t.Fatalf("run %d reused %s or %s", attempt, path, branch)
		}
		seen[path] = true
		seen[branch] = true
		if _, err := os.Stat(filepath.Join(path, "README.md")); err != nil {
			t.Fatalf("worktree %s is not a checkout: %v", path, err)
		}
	}
}

// TestStartupRefusesBeforeCreatingAnything proves every guard fires before any
// worktree exists or any executor starts, so a bad setup leaves no local state.
func TestStartupRefusesBeforeCreatingAnything(t *testing.T) {
	executor := writeExecutor(t, "never-runs", "echo the executor must not start >&2\nexit 9\n")
	cases := []struct {
		name    string
		break_  func(t *testing.T, f *watcherFixture)
		wantErr string
	}{
		{"identity mismatch", func(t *testing.T, f *watcherFixture) {
			f.fake.agentID = "00000000-0000-4000-8000-000000000000"
		}, "expects"},
		{"personal credential", func(t *testing.T, f *watcherFixture) {
			f.fake.agentID = ""
		}, "agent token"},
		{"server without managed runs", func(t *testing.T, f *watcherFixture) {
			f.fake.managedRuns = false
		}, "managed runs"},
		{"missing token", func(t *testing.T, f *watcherFixture) {
			t.Setenv("SLATE_CODEX_TOKEN", "")
		}, "SLATE_CODEX_TOKEN"},
		{"dirty source checkout", func(t *testing.T, f *watcherFixture) {
			if err := os.WriteFile(filepath.Join(f.source, "scratch.txt"), []byte("x"), 0o600); err != nil {
				t.Fatal(err)
			}
		}, "uncommitted changes"},
		{"detached head", func(t *testing.T, f *watcherFixture) {
			commit, err := runGit(context.Background(), f.source, "rev-parse", "HEAD")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := runGit(context.Background(), f.source, "checkout", "--detach", commit); err != nil {
				t.Fatal(err)
			}
		}, "named branch"},
		{"task already in progress", func(t *testing.T, f *watcherFixture) {
			f.fake.workingTasks = []taskView{{ID: testTaskID, Title: "Already going"}}
		}, "already in progress"},
		{"unknown profile", func(t *testing.T, f *watcherFixture) {
			f.profile = "missing"
		}, "no profile named"},
		{"retention limit reached", func(t *testing.T, f *watcherFixture) {
			registry, err := openRegistry()
			if err != nil {
				t.Fatal(err)
			}
			for i := 0; i < maxRetainedRuns; i++ {
				runID, err := newRunID()
				if err != nil {
					t.Fatal(err)
				}
				if err := registry.save(runRecord{RunID: runID, Profile: "codex", State: runStateSuccess}); err != nil {
					t.Fatal(err)
				}
			}
		}, "retained worktrees"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			fixture := newWatcherFixture(t, executor)
			test.break_(t, fixture)
			_, err := fixture.newWatcher(t)
			if err == nil {
				t.Fatal("startup succeeded, want a refusal before anything is created")
			}
			if !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("error = %v, want it to mention %q", err, test.wantErr)
			}
			if strings.Contains(err.Error(), "slate_agent_secret_value") {
				t.Fatalf("the error leaked the credential: %v", err)
			}
			base, baseErr := worktreeBase("codex")
			if baseErr == nil {
				if entries, readErr := os.ReadDir(base); readErr == nil && len(entries) != 0 {
					t.Fatalf("startup created %d worktrees before failing", len(entries))
				}
			}
		})
	}
}

func TestBoardScopeAppliesToBothQueries(t *testing.T) {
	executor := writeExecutor(t, "scoped", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	var scopes []string
	base := fixture.fake
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/agent/tasks" {
			scopes = append(scopes, r.URL.Query().Get("status")+":"+r.URL.Query().Get("boardId"))
		}
		base.serve(w, r)
	}))
	t.Cleanup(server.Close)

	boardID := "5f6d8a1e-1c2b-4d3e-8f90-abcdefabcdef"
	c := client{baseURL: server.URL, http: server.Client()}
	w, err := newWatcher(context.Background(), c, watchOptions{profileName: "codex", workdir: fixture.source, boardID: boardID}, &strings.Builder{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.client.agentTasks("queued", w.boardID, 1); err != nil {
		t.Fatal(err)
	}
	if len(scopes) < 2 {
		t.Fatalf("scoped queries = %v, want the working check and the queued poll", scopes)
	}
	for _, scope := range scopes {
		if !strings.HasSuffix(scope, ":"+boardID) {
			t.Fatalf("query %q is not scoped to board %s", scope, boardID)
		}
	}
	if scopes[0] != "working:"+boardID {
		t.Fatalf("first query = %q, want the working check", scopes[0])
	}
}

func TestRunsListAndCleanManageRetainedWorktrees(t *testing.T) {
	executor := writeExecutor(t, "blocked-codex-2", fmt.Sprintf(`
cat >/dev/null
"$SLATE_BIN" tasks claim %s >/dev/null || exit 1
"$SLATE_BIN" tasks comment %s --body "Blocked." --idempotency-key "blocked" >/dev/null
`, testTaskID, testTaskID))
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.slateBinary = buildTestSlateBinary(t)
	if _, err := w.attempt(context.Background(), fixture.fake.queued[0]); err != nil {
		t.Fatal(err)
	}
	records := fixture.runs(t)
	if len(records) != 1 {
		t.Fatalf("records = %d, want 1", len(records))
	}
	record := records[0]

	// A dirty retained worktree is reported, never force deleted.
	if err := os.WriteFile(filepath.Join(record.Worktree, "unsaved.txt"), []byte("work"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := cleanRun(context.Background(), record.RunID); err == nil {
		t.Fatal("clean removed a dirty worktree")
	}
	if _, err := os.Stat(record.Worktree); err != nil {
		t.Fatalf("clean deleted a dirty worktree: %v", err)
	}

	// Once it is clean, the worktree goes and the branch stays.
	if err := os.Remove(filepath.Join(record.Worktree, "unsaved.txt")); err != nil {
		t.Fatal(err)
	}
	if err := cleanRun(context.Background(), record.RunID); err != nil {
		t.Fatalf("clean refused a clean worktree: %v", err)
	}
	if _, err := os.Stat(record.Worktree); !os.IsNotExist(err) {
		t.Fatalf("clean left the worktree behind: %v", err)
	}
	branches, err := runGit(context.Background(), fixture.source, "branch", "--list", record.Branch)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(branches) == "" {
		t.Fatalf("clean deleted branch %s; commits must stay reachable", record.Branch)
	}
	if remaining := fixture.runs(t); len(remaining) != 0 {
		t.Fatalf("clean left %d records", len(remaining))
	}
	if err := cleanRun(context.Background(), record.RunID); err == nil {
		t.Fatal("clean accepted an unknown run")
	}
}

func TestTheRegistryHoldsNoCredential(t *testing.T) {
	executor := writeExecutor(t, "recording", fmt.Sprintf(`
cat >/dev/null
"$SLATE_BIN" tasks claim %s >/dev/null || exit 1
"$SLATE_BIN" tasks output %s --body "Done." --idempotency-key "k" >/dev/null
`, testTaskID, testTaskID))
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.slateBinary = buildTestSlateBinary(t)
	if _, err := w.attempt(context.Background(), fixture.fake.queued[0]); err != nil {
		t.Fatal(err)
	}
	dir, err := registryDir()
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("no run records were written")
	}
	for _, entry := range entries {
		path := filepath.Join(dir, entry.Name())
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("%s has mode %v, want owner-only", entry.Name(), info.Mode().Perm())
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "slate_agent_secret_value") {
			t.Fatalf("%s contains a credential", entry.Name())
		}
	}
}

// TestAClaimedRunIsNeverTreatedAsALostClaim covers the worst failure this code
// could have. A losing run has its worktree force deleted, so a run that did
// claim must never be classified that way, however the task looks afterwards.
// A human requeueing or completing the card clears the server-side owner, which
// makes a single final reading indistinguishable from never having claimed.
func TestAClaimedRunIsNeverTreatedAsALostClaim(t *testing.T) {
	executor := writeExecutor(t, "unused", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	runID := "dddddddd-4444-4444-8444-dddddddddddd"

	for _, after := range []struct {
		name   string
		status string
		owner  string
	}{
		{"a human requeued it", "queued", ""},
		{"a human completed it", "done", ""},
		{"a human moved it to review", "needs_review", ""},
		{"a human reopened it as working", "working", ""},
		{"another agent claimed it after the requeue", "working", "eeeeeeee-5555-4555-8555-eeeeeeeeeeee"},
	} {
		t.Run(after.name, func(t *testing.T) {
			supervision := &runSupervision{}
			// While the executor worked, the run owned the task.
			fixture.fake.mu.Lock()
			fixture.fake.status = "working"
			fixture.fake.owningRun = runID
			fixture.fake.mu.Unlock()
			if state, decided, _ := w.inspectRun(context.Background(), supervision, testTaskID, runID, false, func() bool { return true }); decided {
				t.Fatalf("decided %q while the executor was still running", state)
			}
			// Then it died, and a person changed the card before the final read.
			fixture.fake.mu.Lock()
			fixture.fake.status = after.status
			fixture.fake.owningRun = after.owner
			fixture.fake.mu.Unlock()
			state, decided, _ := w.inspectRun(context.Background(), supervision, testTaskID, runID, true, func() bool { return false })
			if !decided {
				t.Fatal("the final reading did not decide")
			}
			if state == outcomeLostRace || state == outcomeNeverClaimed {
				t.Fatalf("a run that claimed was classified as %q after %s; its worktree would be force deleted", state, after.name)
			}
			if state != runStateInterrupted {
				t.Fatalf("state = %q, want interrupted", state)
			}
		})
	}
}

// TestOnlyAnUnclaimedRunIsDiscarded is the other half: the watcher must still
// clean up after a genuine losing race, or worktrees accumulate.
func TestOnlyAnUnclaimedRunIsDiscarded(t *testing.T) {
	executor := writeExecutor(t, "unused-2", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	runID := "ffffffff-6666-4666-8666-ffffffffffff"

	for _, after := range []struct {
		name   string
		status string
		owner  string
	}{
		{"another run won the claim", "working", "11111111-7777-4777-8777-111111111111"},
		{"the task is still waiting", "queued", ""},
	} {
		t.Run(after.name, func(t *testing.T) {
			fixture.fake.mu.Lock()
			fixture.fake.status = after.status
			fixture.fake.owningRun = after.owner
			fixture.fake.entries = nil
			fixture.fake.mu.Unlock()
			supervision := &runSupervision{}
			// The watcher always looks at least once while the executor is
			// alive, and never sees this run holding the task.
			if _, decided, _ := w.inspectRun(context.Background(), supervision, testTaskID, runID, false, func() bool { return true }); decided {
				t.Fatal("decided while the executor was still running")
			}
			state, decided, _ := w.inspectRun(context.Background(), supervision, testTaskID, runID, true, func() bool { return false })
			if !decided || (state != outcomeLostRace && state != outcomeNeverClaimed) {
				t.Fatalf("state = %q decided = %v, want the losing run to be discarded", state, decided)
			}
		})
	}
}

// TestAnExecutorThatNeverClaimsDoesNotSpin covers a misconfigured or
// unauthenticated executor. Treating that as an ordinary lost race would spawn
// paid agent sessions and rebuild a worktree as fast as the machine allows.
func TestAnExecutorThatNeverClaimsDoesNotSpin(t *testing.T) {
	executor := writeExecutor(t, "broken-codex", "cat >/dev/null\nexit 7\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	var pauses int
	w.sleep = func(ctx context.Context, d time.Duration) {
		if d != pollInterval {
			t.Errorf("paused for %v, want the poll interval", d)
		}
		pauses++
	}
	err = w.run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "never claimed") {
		t.Fatalf("run returned %v, want it to stop after repeated failures to claim", err)
	}
	if _, _, _, claims := fixture.fake.snapshot(); claims != 0 {
		t.Fatalf("claims = %d, want the broken executor never to have claimed", claims)
	}
	if pauses < launchFailureLimit-1 {
		t.Fatalf("paused %d times before stopping, want a pause between every attempt", pauses)
	}
	if records := fixture.runs(t); len(records) != 0 {
		t.Fatalf("unclaimed runs left %d records", len(records))
	}
}

// TestTheWorkingGuardIsRecheckedBeforeEveryOffer covers a task entering the
// scoped working set after this watcher completed its first run. No second
// executor may start until a person resolves that in-progress task.
func TestTheWorkingGuardIsRecheckedBeforeEveryOffer(t *testing.T) {
	executor := writeExecutor(t, "one-run-codex", fmt.Sprintf(`
cat >/dev/null
"$SLATE_BIN" tasks claim %s >/dev/null || exit 1
"$SLATE_BIN" tasks output %s --body "Done." --idempotency-key "out" >/dev/null
`, testTaskID, testTaskID))
	fixture := newWatcherFixture(t, executor)
	fixture.fake.workingAfterClaim = true

	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.slateBinary = buildTestSlateBinary(t)
	err = w.run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "already in progress") {
		t.Fatalf("run returned %v, want the later working task to stop dispatch", err)
	}
	if _, _, _, claims := fixture.fake.snapshot(); claims != 1 {
		t.Fatalf("claims = %d, want exactly one executor launch", claims)
	}
}

// TestALostRaceIsNotAnExecutorFailure keeps the other half honest: losing to a
// competing watcher is normal and must not count toward the failure limit.
func TestALostRaceIsNotAnExecutorFailure(t *testing.T) {
	executor := writeExecutor(t, "losing-codex-2", "cat >/dev/null\nexit 1\n")
	fixture := newWatcherFixture(t, executor)
	fixture.fake.status = "working"
	fixture.fake.owningRun = "aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa"
	fixture.fake.workingTasks = nil

	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	state, err := w.attempt(context.Background(), taskView{ID: testTaskID, Title: "Add the thing"})
	if err != nil {
		t.Fatal(err)
	}
	if state != outcomeLostRace {
		t.Fatalf("state = %q, want a lost race", state)
	}
}

// TestRetentionIsRecheckedEveryRound proves the ten-worktree cap protects an
// unattended watcher, not only startup.
func TestRetentionIsRecheckedEveryRound(t *testing.T) {
	executor := writeExecutor(t, "unused-3", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	// The watcher started under the limit and then filled it while running.
	registry, err := openRegistry()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < maxRetainedRuns; i++ {
		runID, err := newRunID()
		if err != nil {
			t.Fatal(err)
		}
		if err := registry.save(runRecord{RunID: runID, Profile: "codex", State: runStateSuccess}); err != nil {
			t.Fatal(err)
		}
	}
	err = w.run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "retained worktrees") {
		t.Fatalf("run returned %v, want it to stop at the retention limit", err)
	}
	if _, _, _, claims := fixture.fake.snapshot(); claims != 0 {
		t.Fatalf("claims = %d, want no run to start at the limit", claims)
	}
}

func TestOverLimitCleanupFailureKeepsTheRunDiscoverable(t *testing.T) {
	executor := writeExecutor(t, "unused-over-limit", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < maxRetainedRuns; index++ {
		runID, err := newRunID()
		if err != nil {
			t.Fatal(err)
		}
		if err := w.registry.save(runRecord{RunID: runID, Profile: w.profileName, State: runStateSuccess}); err != nil {
			t.Fatal(err)
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	w.registry.beforeSave = func(record runRecord) error {
		if record.TaskID == testTaskID && record.State == runStateLaunching {
			cancel()
		}
		return nil
	}
	state, err := w.attempt(ctx, fixture.fake.queued[0])
	if err == nil || !strings.Contains(err.Error(), "remains in 'slate runs list'") {
		t.Fatalf("state = %q err = %v, want a discoverable cleanup failure", state, err)
	}
	if state != runStateAmbiguous {
		t.Fatalf("state = %q, want ambiguous", state)
	}
	records := fixture.runs(t)
	var retained *runRecord
	for index := range records {
		if records[index].TaskID == testTaskID {
			retained = &records[index]
			break
		}
	}
	if retained == nil || retained.State != runStateAmbiguous {
		t.Fatalf("records = %+v, want the failed cleanup retained as ambiguous", records)
	}
	branches, gitErr := runGit(context.Background(), fixture.source, "branch", "--list", retained.Branch)
	if gitErr != nil || !strings.Contains(branches, retained.Branch) {
		t.Fatalf("retained branch is not inspectable: %q %v", branches, gitErr)
	}
}

func TestLaunchCleanupFailureKeepsTheRunDiscoverable(t *testing.T) {
	executor := writeExecutor(t, "vanishing-executor", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(executor); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	w.registry.beforeSave = func(record runRecord) error {
		if record.TaskID == testTaskID && record.State == runStateLaunching {
			cancel()
		}
		return nil
	}
	state, err := w.attempt(ctx, fixture.fake.queued[0])
	if err == nil || !strings.Contains(err.Error(), "remains in 'slate runs list'") {
		t.Fatalf("state = %q err = %v, want a discoverable launch cleanup failure", state, err)
	}
	if state != runStateAmbiguous {
		t.Fatalf("state = %q, want ambiguous", state)
	}
	records := fixture.runs(t)
	if len(records) != 1 || records[0].TaskID != testTaskID || records[0].State != runStateAmbiguous {
		t.Fatalf("records = %+v, want the failed launch cleanup retained", records)
	}
	branches, gitErr := runGit(context.Background(), fixture.source, "branch", "--list", records[0].Branch)
	if gitErr != nil || !strings.Contains(branches, records[0].Branch) {
		t.Fatalf("retained branch is not inspectable: %q %v", branches, gitErr)
	}
}

func TestInitialRecordAndCleanupFailuresKeepTheRunDiscoverable(t *testing.T) {
	executor := writeExecutor(t, "unused-initial-save", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	writes := 0
	w.registry.beforeSave = func(record runRecord) error {
		writes++
		if writes == 1 {
			cancel()
			return errors.New("state directory rejected the first write")
		}
		return nil
	}
	state, err := w.attempt(ctx, fixture.fake.queued[0])
	if err == nil || !strings.Contains(err.Error(), "remains in 'slate runs list'") {
		t.Fatalf("state = %q err = %v, want both failures reported", state, err)
	}
	if state != runStateAmbiguous {
		t.Fatalf("state = %q, want ambiguous", state)
	}
	records := fixture.runs(t)
	if len(records) != 1 || records[0].State != runStateAmbiguous || records[0].TaskID != testTaskID {
		t.Fatalf("records = %+v, want the orphan risk retained", records)
	}
}

func TestUnrecordedCleanupFailureStopsDispatch(t *testing.T) {
	executor := writeExecutor(t, "unused-unrecorded", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	w.registry.beforeSave = func(runRecord) error {
		cancel()
		return errors.New("state directory stays unavailable")
	}
	state, err := w.attempt(ctx, fixture.fake.queued[0])
	if state != runStateAmbiguous || !errors.Is(err, errUndiscoverableRun) {
		t.Fatalf("state = %q err = %v, want an undiscoverable ambiguous run", state, err)
	}
	if recoverableAttemptError(err) {
		t.Fatal("the watcher would continue after it could neither clean nor record a run")
	}
	if !strings.Contains(err.Error(), "worktrees") || !strings.Contains(err.Error(), "slate/") {
		t.Fatalf("error does not name the orphan paths: %v", err)
	}
}

func TestDisposableRecordRemovalFailureStopsDispatch(t *testing.T) {
	executor := writeExecutor(t, "losing-remove", "cat >/dev/null\nexit 1\n")
	fixture := newWatcherFixture(t, executor)
	fixture.fake.status = "working"
	fixture.fake.owningRun = "aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa"
	fixture.fake.workingTasks = nil
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.registry.beforeRemove = func(string) error { return errors.New("state directory is read-only") }

	state, err := w.attempt(context.Background(), fixture.fake.queued[0])
	if err == nil || !errors.Is(err, errRunRecordRemoval) {
		t.Fatalf("state = %q err = %v, want the removal failure propagated", state, err)
	}
	if recoverableAttemptError(err) {
		t.Fatal("the watcher would continue and accumulate stale retained records")
	}
	if records := fixture.runs(t); len(records) != 1 {
		t.Fatalf("records = %+v, want the stale record visible for cleanup", records)
	}
}

// TestTwoWatchersRaceAndOnlyTheClaimantContinues drives two real watchers with
// real worktrees against one task, which is the isolation the design exists for.
func TestTwoWatchersRaceAndOnlyTheClaimantContinues(t *testing.T) {
	executor := writeExecutor(t, "racing-codex", fmt.Sprintf(`
cat >/dev/null
"$SLATE_BIN" tasks claim %s >/dev/null 2>&1 || exit 1
echo "work" > implementation.txt
"$SLATE_BIN" tasks output %s --body "Done." --idempotency-key "out" >/dev/null 2>&1
`, testTaskID, testTaskID))
	fixture := newWatcherFixture(t, executor)
	binary := buildTestSlateBinary(t)

	first, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	first.slateBinary = binary
	second, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	second.slateBinary = binary

	candidate := fixture.fake.queued[0]
	states := make([]string, 2)
	var wait sync.WaitGroup
	for index, w := range []*watcher{first, second} {
		wait.Add(1)
		go func(index int, w *watcher) {
			defer wait.Done()
			state, err := w.attempt(context.Background(), candidate)
			if err != nil {
				t.Errorf("watcher %d: %v", index, err)
				return
			}
			states[index] = state
		}(index, w)
	}
	wait.Wait()

	// The loser's label depends on timing, and more than one is correct. If it
	// reads the task while the winner still holds it, that is a lost race and
	// its worktree goes. If the winner has already finished and the task has
	// moved to review, the loser cannot prove it never held the task, so it is
	// ambiguous and keeps its worktree. Both are safe; only deleting on a guess
	// would not be. What must be exact is that one run won.
	winners := 0
	for _, state := range states {
		switch state {
		case runStateSuccess:
			winners++
		case outcomeLostRace, outcomeNeverClaimed, runStateAmbiguous:
		default:
			t.Fatalf("states = %v, want one winner and one loser", states)
		}
	}
	if winners != 1 {
		t.Fatalf("states = %v, want exactly one winner", states)
	}
	_, _, entries, claims := fixture.fake.snapshot()
	if claims != 2 || entries != 1 {
		t.Fatalf("claims = %d entries = %d, want both to try and only one to report", claims, entries)
	}
	// The winner is retained with its work intact. A loser that could not be
	// placed may be retained too, but it must never be recorded as a success.
	records := fixture.runs(t)
	var winner *runRecord
	for index := range records {
		if records[index].State == runStateSuccess {
			if winner != nil {
				t.Fatalf("records = %+v, want one successful run", records)
			}
			winner = &records[index]
		}
	}
	if winner == nil {
		t.Fatalf("records = %+v, want the winner retained", records)
	}
	if _, err := os.Stat(filepath.Join(winner.Worktree, "implementation.txt")); err != nil {
		t.Fatalf("the winner's work is missing: %v", err)
	}
	status, err := runGit(context.Background(), fixture.source, "status", "--porcelain")
	if err != nil || status != "" {
		t.Fatalf("source checkout changed: %q %v", status, err)
	}
	branches, err := runGit(context.Background(), fixture.source, "branch", "--list", "slate/*")
	if err != nil {
		t.Fatal(err)
	}
	named := []string{}
	for _, field := range strings.Fields(branches) {
		if field == "*" || field == "+" {
			continue
		}
		named = append(named, field)
	}
	if len(named) != len(records) {
		t.Fatalf("branches = %q, want one per retained run %+v", branches, records)
	}
	if !slices.Contains(named, winner.Branch) {
		t.Fatalf("branches = %q, want the winner's %s kept", branches, winner.Branch)
	}
}

// TestTwoWatcherProcessesCompeteForOneTask exercises the CLI boundary that an
// operator uses: two independent watcher processes, each with its own startup,
// polling loop, process state, and executor. The barrier makes both executors
// reach the claim before either can finish the task.
func TestTwoWatcherProcessesCompeteForOneTask(t *testing.T) {
	barrier := filepath.Join(t.TempDir(), "executor-starts")
	executor := writeExecutor(t, "process-racing-codex", fmt.Sprintf(`
cat >/dev/null
echo started >> %q
while [ "$(wc -l < %q)" -lt 2 ]; do sleep 0.02; done
"$SLATE_BIN" tasks claim %s >/dev/null 2>&1 || exit 1
echo "work" > implementation.txt
"$SLATE_BIN" tasks output %s --body "Done." --idempotency-key "out-$SLATE_RUN_ID" >/dev/null 2>&1
`, barrier, barrier, testTaskID, testTaskID))
	fixture := newWatcherFixture(t, executor)
	binary := buildTestSlateBinary(t)

	type runningWatcher struct {
		command *exec.Cmd
		output  bytes.Buffer
	}
	watchers := make([]runningWatcher, 2)
	for index := range watchers {
		command := exec.Command(binary, "watch", "--profile", fixture.profile, "--workdir", fixture.source)
		command.Env = append(os.Environ(), "SLATE_BASE_URL="+fixture.server.URL)
		command.Stdout = &watchers[index].output
		command.Stderr = &watchers[index].output
		watchers[index].command = command
		if err := command.Start(); err != nil {
			t.Fatalf("start watcher %d: %v", index, err)
		}
		t.Cleanup(func() {
			if command.ProcessState == nil {
				_ = command.Process.Kill()
				_ = command.Wait()
			}
		})
	}

	deadline := time.Now().Add(15 * time.Second)
	for {
		_, _, entries, claims := fixture.fake.snapshot()
		records := fixture.runs(t)
		successes := 0
		for _, record := range records {
			if record.State == runStateSuccess {
				successes++
			}
		}
		if entries == 1 && claims >= 2 && successes == 1 {
			break
		}
		if time.Now().After(deadline) {
			for _, watcher := range watchers {
				_ = watcher.command.Process.Kill()
			}
			t.Fatalf("watchers did not settle: claims=%d entries=%d", claims, entries)
		}
		time.Sleep(20 * time.Millisecond)
	}

	for index := range watchers {
		if err := watchers[index].command.Process.Signal(os.Interrupt); err != nil {
			t.Fatalf("interrupt watcher %d: %v", index, err)
		}
	}
	for index := range watchers {
		done := make(chan error, 1)
		go func(command *exec.Cmd) { done <- command.Wait() }(watchers[index].command)
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("watcher %d exited with %v:\n%s", index, err, watchers[index].output.String())
			}
		case <-time.After(5 * time.Second):
			_ = watchers[index].command.Process.Kill()
			t.Fatalf("watcher %d did not stop after interrupt:\n%s", index, watchers[index].output.String())
		}
	}

	status, _, entries, claims := fixture.fake.snapshot()
	if status != "needs_review" || entries != 1 || claims != 2 {
		t.Fatalf("server state = %s, claims=%d entries=%d; want one output from two claims", status, claims, entries)
	}
	records := fixture.runs(t)
	successes := 0
	for _, record := range records {
		if record.State == runStateSuccess {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("records = %+v, want exactly one successful process", records)
	}
}

// TestTheExecutorGroupIsGoneBeforeTheNextCandidate proves one watcher runs one
// process group. A grandchild that ignores SIGTERM must still be gone.
func TestTheExecutorGroupIsGoneBeforeTheNextCandidate(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "grandchild.pid")
	executor := writeExecutor(t, "stubborn-codex", fmt.Sprintf(`
cat >/dev/null
trap '' TERM
( trap '' TERM; while true; do sleep 0.2; done ) &
echo $! > %s
"$SLATE_BIN" tasks claim %s >/dev/null || exit 1
"$SLATE_BIN" tasks output %s --body "Done." --idempotency-key "out" >/dev/null
while true; do sleep 0.2; done
`, marker, testTaskID, testTaskID))
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.slateBinary = buildTestSlateBinary(t)

	state, err := w.attempt(context.Background(), fixture.fake.queued[0])
	if err != nil {
		t.Fatal(err)
	}
	if state != runStateSuccess {
		t.Fatalf("state = %q, want success", state)
	}
	raw, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal(err)
	}
	grandchild := strings.TrimSpace(string(raw))
	// attempt only returns once the group is confirmed gone, so nothing from
	// the run may still be alive by now.
	check := exec.Command("kill", "-0", grandchild)
	if err := check.Run(); err == nil {
		t.Fatalf("grandchild %s survived the run; a second executor could start alongside it", grandchild)
	}
	records := fixture.runs(t)
	if len(records) != 1 || records[0].ProcessGroupID != 0 {
		t.Fatalf("records = %+v, want the process group cleared once it is gone", records)
	}
}

// TestACrashedWatcherLeavesAReleasableWorktree covers the record a killed
// watcher leaves behind: nothing is alive, so cleanup must still work.
func TestACrashedWatcherLeavesAReleasableWorktree(t *testing.T) {
	executor := writeExecutor(t, "unused-4", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	runID, err := newRunID()
	if err != nil {
		t.Fatal(err)
	}
	worktree, branch, err := createRunWorktree(context.Background(), w.source, "codex", testTaskID, runID)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := openRegistry()
	if err != nil {
		t.Fatal(err)
	}
	// The state a watcher killed mid-run leaves on disk.
	if err := registry.save(runRecord{
		RunID: runID, Profile: "codex", TaskID: testTaskID, Branch: branch, Worktree: worktree,
		SourceRepository: w.source.Root, State: runStateWorking, ChildPID: 0, ProcessGroupID: 0,
	}); err != nil {
		t.Fatal(err)
	}
	if err := cleanRun(context.Background(), runID); err != nil {
		t.Fatalf("clean refused a crashed run's worktree: %v", err)
	}
	if _, err := os.Stat(worktree); !os.IsNotExist(err) {
		t.Fatalf("clean left the worktree behind: %v", err)
	}
	if err := cleanRun(context.Background(), "../escape"); err == nil {
		t.Fatal("clean accepted a run ID that is not an ID")
	}
}

// TestACompletedReviewStillCountsAsSuccess covers a reviewer approving the work
// inside a poll interval of the output landing.
func TestACompletedReviewStillCountsAsSuccess(t *testing.T) {
	executor := writeExecutor(t, "unused-5", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	runID := "cccccccc-9999-4999-8999-cccccccccccc"
	fixture.fake.mu.Lock()
	fixture.fake.status = "done"
	fixture.fake.owningRun = ""
	fixture.fake.entries = []entryView{{ID: "1", Kind: "output", AuthorKind: "agent", RunID: runID}}
	fixture.fake.mu.Unlock()

	state, decided, _ := w.inspectRun(context.Background(), &runSupervision{}, testTaskID, runID, true, func() bool { return false })
	if !decided || state != runStateSuccess {
		t.Fatalf("state = %q decided = %v, want success after a fast review", state, decided)
	}
}

// TestAnUnwitnessedRunIsNotDiscarded covers the paths the latch cannot cover.
// Ownership is sampled, so a run the watcher never managed to see holding its
// task must not be treated as one that never claimed.
func TestAnUnwitnessedRunIsNotDiscarded(t *testing.T) {
	executor := writeExecutor(t, "unused-6", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	runID := "abcdabcd-1010-4010-8010-abcdabcdabcd"

	t.Run("the connection dropped while the run held the task", func(t *testing.T) {
		// The realistic shape: the launch reading succeeds, then the API is
		// unreachable for the whole stretch the run owned the task, a person
		// requeues it, and the connection recovers before the run dies. The
		// recovered reading is indistinguishable from a run that never claimed,
		// so the unseen stretch is what the watcher has to go on.
		supervision := &runSupervision{}
		fixture.fake.mu.Lock()
		fixture.fake.status = "queued"
		fixture.fake.owningRun = ""
		fixture.fake.entries = nil
		fixture.fake.mu.Unlock()
		if _, decided, _ := w.inspectRun(context.Background(), supervision, testTaskID, runID, false, func() bool { return true }); decided {
			t.Fatal("the launch reading decided the run")
		}
		if !supervision.observed {
			t.Fatal("the launch reading did not count as a sighting")
		}

		blind := *w
		blind.client = client{baseURL: "http://127.0.0.1:1", http: fixture.server.Client()}
		if _, decided, _ := blind.inspectRun(context.Background(), supervision, testTaskID, runID, false, func() bool { return true }); decided {
			t.Fatal("a failed reading decided the run")
		}
		if !supervision.readFailed {
			t.Fatal("a failed reading while the run was alive was not recorded")
		}

		state, decided, _ := w.inspectRun(context.Background(), supervision, testTaskID, runID, true, func() bool { return false })
		if !decided || state != runStateAmbiguous {
			t.Fatalf("state = %q decided = %v, want the run kept after an unseen stretch", state, decided)
		}
	})

	t.Run("every reading during the run failed", func(t *testing.T) {
		// A network problem covers the whole time the run owned the task, and
		// then clears. The recovered post-mortem reading sees a requeued task
		// and looks exactly like a run that never claimed, so the watcher must
		// fall back on never having had the chance to look.
		blind := *w
		blind.client = client{baseURL: "http://127.0.0.1:1", http: fixture.server.Client()}
		supervision := &runSupervision{}
		if _, decided, _ := blind.inspectRun(context.Background(), supervision, testTaskID, runID, false, func() bool { return true }); decided {
			t.Fatal("a failed reading decided the run")
		}
		if supervision.observed {
			t.Fatal("a failed reading counted as a sighting")
		}
		fixture.fake.mu.Lock()
		fixture.fake.status = "queued"
		fixture.fake.owningRun = ""
		fixture.fake.entries = nil
		fixture.fake.mu.Unlock()
		state, decided, _ := w.inspectRun(context.Background(), supervision, testTaskID, runID, true, func() bool { return false })
		if !decided || state != runStateAmbiguous {
			t.Fatalf("state = %q decided = %v, want the run kept as ambiguous", state, decided)
		}
	})

	t.Run("a post-mortem reading alone cannot prove a claim never happened", func(t *testing.T) {
		// The same shape without any network problem: the only sighting while
		// the run was alive is the one the watcher took, and it must be the
		// one that counts.
		supervision := &runSupervision{}
		fixture.fake.mu.Lock()
		fixture.fake.status = "queued"
		fixture.fake.owningRun = ""
		fixture.fake.entries = nil
		fixture.fake.mu.Unlock()
		if _, decided, _ := w.inspectRun(context.Background(), supervision, testTaskID, runID, false, func() bool { return true }); decided {
			t.Fatal("decided while the executor was still running")
		}
		if !supervision.observed {
			t.Fatal("a successful reading while alive did not count as a sighting")
		}
	})

	t.Run("a legacy claim leaves the task working with no owner", func(t *testing.T) {
		fixture.fake.mu.Lock()
		fixture.fake.status = "working"
		fixture.fake.owningRun = ""
		fixture.fake.entries = nil
		fixture.fake.mu.Unlock()
		state, decided, _ := w.inspectRun(context.Background(), &runSupervision{}, testTaskID, runID, true, func() bool { return false })
		if !decided || state != runStateAmbiguous {
			t.Fatalf("state = %q, want ambiguous rather than a discard or a halt", state)
		}
	})
}

// TestTheWatcherKeepsGoingAfterAnAmbiguousRun proves an unplaceable run does
// not stop an unattended watcher, and that its worktree survives.
func TestTheWatcherKeepsGoingAfterAnAmbiguousRun(t *testing.T) {
	executor := writeExecutor(t, "legacy-loser", "cat >/dev/null\nexit 3\n")
	fixture := newWatcherFixture(t, executor)
	// A legacy agent already holds the task: working, with no managed owner.
	fixture.fake.status = "working"
	fixture.fake.owningRun = ""
	fixture.fake.workingTasks = nil

	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	state, err := w.attempt(context.Background(), taskView{ID: testTaskID, Title: "Add the thing"})
	if err != nil {
		t.Fatal(err)
	}
	if state != runStateAmbiguous {
		t.Fatalf("state = %q, want ambiguous", state)
	}
	records := fixture.runs(t)
	if len(records) != 1 || records[0].State != runStateAmbiguous {
		t.Fatalf("records = %+v, want the ambiguous run retained", records)
	}
	if _, err := os.Stat(records[0].Worktree); err != nil {
		t.Fatalf("an ambiguous worktree was deleted: %v", err)
	}
	if !records[0].retained() {
		t.Fatal("an ambiguous run does not count toward retention, so it could never be cleaned")
	}
}

// TestTheFirstSightingIsPolledQuickly pins the mitigation for the one window
// the latch cannot close: a claim and death inside a single polling gap.
func TestTheFirstSightingIsPolledQuickly(t *testing.T) {
	if firstObservationInterval >= pollInterval {
		t.Fatalf("first sighting interval %v is not shorter than the steady interval %v", firstObservationInterval, pollInterval)
	}
	if firstObservationInterval > time.Second {
		t.Fatalf("first sighting interval %v leaves too wide a window before ownership is witnessed", firstObservationInterval)
	}
}

// TestAnEmptyGroupIsNeverSignalledAfterReaping covers process ID recycling.
// A reaped child's ID can be handed to an unrelated process, and the ID doubles
// as the group ID here, so a later liveness check can be a false positive. The
// watcher must trust only the reading taken at the moment of reaping.
func TestAnEmptyGroupIsNeverSignalledAfterReaping(t *testing.T) {
	w := &watcher{out: &strings.Builder{}, now: time.Now}

	var signalled []int
	originalSignal := signalGroupForTest
	originalAlive := groupAliveForTest
	signalGroupForTest = func(processGroupID int, signal syscall.Signal) error {
		signalled = append(signalled, processGroupID)
		return nil
	}
	// The operating system has already handed this ID to somebody else, so a
	// liveness check now answers yes about a group the watcher never started.
	groupAliveForTest = func(int) bool { return true }
	t.Cleanup(func() {
		signalGroupForTest = originalSignal
		groupAliveForTest = originalAlive
	})

	emptyAtReap := false
	w.stopExecutorGroup(4242, true, &emptyAtReap)
	if len(signalled) != 0 {
		t.Fatalf("signalled %v after reaping an empty group; that ID may belong to another program", signalled)
	}

	// A group that still had processes when the child was reaped is signalled,
	// and the escalation stops as soon as the group is gone.
	var checks int
	groupAliveForTest = func(int) bool {
		checks++
		return checks <= 1
	}
	remnantAtReap := true
	w.stopExecutorGroup(4242, true, &remnantAtReap)
	if len(signalled) != 1 || signalled[0] != 4242 {
		t.Fatalf("signalled %v, want one signal to the run's own group", signalled)
	}
}

// TestTheLoopCarriesTheBoardScope runs one real iteration and asserts the
// queued query is scoped, alongside the startup check.
func TestTheLoopCarriesTheBoardScope(t *testing.T) {
	executor := writeExecutor(t, "scoped-loop", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	var queries []string
	base := fixture.fake
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/agent/tasks" {
			queries = append(queries, r.URL.Query().Get("status")+":"+r.URL.Query().Get("boardId"))
		}
		base.serve(w, r)
	}))
	t.Cleanup(server.Close)

	boardID := "5f6d8a1e-1c2b-4d3e-8f90-abcdefabcdef"
	// Nothing is queued, so the loop polls and then stops when the context ends.
	base.mu.Lock()
	base.status = "needs_review"
	base.mu.Unlock()

	c := client{baseURL: server.URL, http: server.Client()}
	w, err := newWatcher(context.Background(), c, watchOptions{profileName: "codex", workdir: fixture.source, boardID: boardID}, &strings.Builder{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	rounds := 0
	w.sleep = func(context.Context, time.Duration) {
		rounds++
		if rounds >= 2 {
			cancel()
		}
	}
	if err := w.run(ctx); err != nil {
		t.Fatal(err)
	}
	if len(queries) < 2 {
		t.Fatalf("queries = %v, want the startup check and at least one poll", queries)
	}
	if queries[0] != "working:"+boardID {
		t.Fatalf("first query = %q, want the scoped working check", queries[0])
	}
	queuedQueries := 0
	for _, query := range queries[1:] {
		if query == "queued:"+boardID {
			queuedQueries++
			continue
		}
		if query != "working:"+boardID {
			t.Fatalf("loop query %q is not scoped to board %s", query, boardID)
		}
	}
	if queuedQueries == 0 {
		t.Fatalf("queries = %v, want a scoped queued poll", queries)
	}
}

// TestThePromptKeepsTheWorktreeCleanable came from running the watcher for
// real: an agent that wrote its report inside the worktree left it untracked,
// which makes "slate runs clean" refuse the worktree for ever.
func TestThePromptKeepsTheWorktreeCleanable(t *testing.T) {
	prompt := buildPrompt(promptDetails{
		AgentID: testAgentID, AgentName: "Codex", TaskID: testTaskID, TaskTitle: "Do the thing",
		RunID: "abcdabcd-1010-4010-8010-abcdabcdabcd", Worktree: "/tmp/worktree", Branch: "slate/x",
	})
	for _, expected := range []string{
		"OUTSIDE this worktree",
		"${TMPDIR:-/tmp}/slate-report-$SLATE_RUN_ID.md",
		"${TMPDIR:-/tmp}/slate-note-$SLATE_RUN_ID.md",
		"leave nothing",
	} {
		if !strings.Contains(prompt, expected) {
			t.Errorf("the prompt does not tell the agent to %q:\n%s", expected, prompt)
		}
	}
	if strings.Contains(prompt, "--file <path to your report>") {
		t.Error("the prompt still suggests an unqualified report path")
	}
}

// TestAnExitDuringAReadIsNotASighting covers an executor that dies while the
// monitoring requests are in flight. The answers arrive post-mortem, so they
// cannot be counted as having seen the run alive.
func TestAnExitDuringAReadIsNotASighting(t *testing.T) {
	executor := writeExecutor(t, "unused-inflight", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	runID := "12341234-1234-4234-8234-123412341234"
	fixture.fake.mu.Lock()
	fixture.fake.status = "queued"
	fixture.fake.owningRun = ""
	fixture.fake.entries = nil
	fixture.fake.mu.Unlock()

	supervision := &runSupervision{}
	// The loop still believes the executor is running, but it exited while the
	// responses were on the wire.
	if _, decided, err := w.inspectRun(context.Background(), supervision, testTaskID, runID, false, func() bool { return false }); decided || err != nil {
		t.Fatalf("decided = %v err = %v, want an undecided reading", decided, err)
	}
	if supervision.observed {
		t.Fatal("a reading that completed after the executor exited counted as a sighting")
	}
	state, decided, err := w.inspectRun(context.Background(), supervision, testTaskID, runID, true, func() bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	if !decided || state != runStateAmbiguous {
		t.Fatalf("state = %q, want the run kept rather than discarded on a stale sighting", state)
	}
}

func TestAReadFailureThatOverlapsExecutorExitMarksTheRunUncertain(t *testing.T) {
	executor := writeExecutor(t, "unused-overlap", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	alive := true
	var aliveMu sync.Mutex
	base := fixture.fake
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/tasks/") && !strings.HasSuffix(r.URL.Path, "/entries") {
			aliveMu.Lock()
			alive = false
			aliveMu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":"temporary"}`))
			return
		}
		base.serve(w, r)
	}))
	t.Cleanup(server.Close)

	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.client.baseURL = server.URL
	w.client.http = server.Client()
	supervision := &runSupervision{}
	stillAlive := func() bool {
		aliveMu.Lock()
		defer aliveMu.Unlock()
		return alive
	}
	if _, decided, err := w.inspectRun(context.Background(), supervision, testTaskID, "12341234-1234-4234-8234-123412341234", false, stillAlive); decided || err != nil {
		t.Fatalf("decided = %v err = %v, want a retryable uncertain read", decided, err)
	}
	if !supervision.readFailed {
		t.Fatal("a failed read that began while the executor was alive was not recorded")
	}
}

// TestATerminalMonitoringErrorStopsTheExecutor covers a credential revoked
// mid-run. Polling forever would leave an unauthenticated agent running.
func TestATerminalMonitoringErrorStopsTheExecutor(t *testing.T) {
	executor := writeExecutor(t, "long-runner", fmt.Sprintf(`
cat >/dev/null
"$SLATE_BIN" tasks claim %s >/dev/null 2>&1
while true; do sleep 0.2; done
`, testTaskID))
	fixture := newWatcherFixture(t, executor)
	revoked := false
	base := fixture.fake
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if revoked && strings.HasPrefix(r.URL.Path, "/api/v1/tasks/") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"authentication required"}`))
			return
		}
		base.serve(w, r)
	}))
	t.Cleanup(server.Close)

	c := client{baseURL: server.URL, http: server.Client()}
	w, err := newWatcher(context.Background(), c, watchOptions{profileName: "codex", workdir: fixture.source}, &strings.Builder{})
	if err != nil {
		t.Fatal(err)
	}
	w.slateBinary = buildTestSlateBinary(t)
	w.sleep = func(context.Context, time.Duration) {}
	revoked = true

	state, err := w.attempt(context.Background(), fixture.fake.queued[0])
	if err == nil {
		t.Fatal("a revoked credential did not stop the run")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Fatalf("error = %v, want it to name the terminal response", err)
	}
	if state != runStateAmbiguous {
		t.Fatalf("state = %q, want the worktree kept", state)
	}
	records := fixture.runs(t)
	if len(records) != 1 {
		t.Fatalf("records = %+v, want the run retained", records)
	}
	if _, statErr := os.Stat(records[0].Worktree); statErr != nil {
		t.Fatalf("the worktree was deleted after a terminal error: %v", statErr)
	}
}

// TestALocalRecordFailureAfterLaunchKeepsTheWorktree covers a state directory
// that breaks after the executor is already running.
func TestALocalRecordFailureAfterLaunchKeepsTheWorktree(t *testing.T) {
	executor := writeExecutor(t, "started-codex", "cat >/dev/null\nexit 0\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	// The state directory breaks after the launching record is written, which
	// is the moment the executor is already running.
	writes := 0
	w.registry.beforeSave = func(runRecord) error {
		writes++
		if writes >= 2 {
			return errors.New("state directory is unwritable")
		}
		return nil
	}

	state, err := w.attempt(context.Background(), fixture.fake.queued[0])
	if err == nil && state != runStateAmbiguous {
		t.Fatalf("state = %q err = %v, want the run kept as ambiguous", state, err)
	}
	base, err := worktreeBase("codex")
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		t.Fatalf("the worktree directory is gone: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("worktrees = %d, want the started run's worktree kept", len(entries))
	}
}

// TestAProfileWithTrailingContentIsRejected keeps startup validation strict.
func TestAProfileWithTrailingContentIsRejected(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	path := filepath.Join(home, "config.json")
	valid := fmt.Sprintf(`{"profiles":{"codex":{"agentId":%q,"tokenEnv":"T","command":["x"]}}}`, testAgentID)
	if err := os.WriteFile(path, []byte(valid+valid), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SLATE_CONFIG", path)
	if _, err := loadProfile("codex"); err == nil {
		t.Fatal("two concatenated configuration objects were accepted")
	} else if !strings.Contains(err.Error(), "content after") {
		t.Fatalf("error = %v, want it to name the trailing content", err)
	}
	if err := os.WriteFile(path, []byte(valid), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadProfile("codex"); err != nil {
		t.Fatalf("a single valid object was rejected: %v", err)
	}
}

// TestAFailedWorktreeAddLeavesNoBranch covers a checkout that fails after Git
// has already created the branch.
func TestAFailedWorktreeAddLeavesNoBranch(t *testing.T) {
	executor := writeExecutor(t, "unused-branch", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	runID, err := newRunID()
	if err != nil {
		t.Fatal(err)
	}
	// A file where the worktree should go makes the checkout fail after the
	// branch has been created.
	base, err := worktreeBase("codex")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatal(err)
	}
	branch := runBranchName(testTaskID, runID)
	if _, err := runGit(context.Background(), w.source.Root, "branch", branch, w.source.Commit); err != nil {
		t.Fatal(err)
	}
	// The branch already exists, so "worktree add -b" fails.
	if _, _, err := createRunWorktree(context.Background(), w.source, "codex", testTaskID, runID); err == nil {
		t.Fatal("creating a worktree on an existing branch succeeded")
	}
	// The pre-existing branch must survive: cleanup may only remove refs the
	// run created itself.
	surviving, err := runGit(context.Background(), w.source.Root, "branch", "--list", branch)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(surviving) == "" {
		t.Fatalf("a failed worktree add deleted branch %s, which it did not create", branch)
	}
	if _, err := runGit(context.Background(), w.source.Root, "branch", "-D", branch); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(base)
	if err == nil && len(entries) != 0 {
		t.Fatalf("a failed worktree add left %d directories", len(entries))
	}
}

// TestRunsWithoutASubcommandShowsUsage covers the bare command, which indexed
// an empty slice before.
func TestRunsWithoutASubcommandShowsUsage(t *testing.T) {
	if err := runsCmd(nil); err != nil {
		t.Fatalf("bare runs = %v, want help", err)
	}
	if err := runsCmd([]string{}); err != nil {
		t.Fatalf("empty runs = %v, want help", err)
	}
	if err := runsCmd([]string{"nonsense"}); err == nil {
		t.Fatal("an unknown runs command was accepted")
	}
}

// TestATerminalRunFailureStopsTheWatcher proves the loop does not treat a
// terminal server answer as a local hiccup and launch another executor.
func TestATerminalRunFailureStopsTheWatcher(t *testing.T) {
	executor := writeExecutor(t, "claiming-codex", fmt.Sprintf(`
cat >/dev/null
"$SLATE_BIN" tasks claim %s >/dev/null 2>&1
sleep 0.3
`, testTaskID))
	fixture := newWatcherFixture(t, executor)
	launches := 0
	base := fixture.fake
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/claim") {
			launches++
		}
		if launches > 0 && strings.HasPrefix(r.URL.Path, "/api/v1/tasks/") && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
			return
		}
		base.serve(w, r)
	}))
	t.Cleanup(server.Close)

	c := client{baseURL: server.URL, http: server.Client()}
	w, err := newWatcher(context.Background(), c, watchOptions{profileName: "codex", workdir: fixture.source}, &strings.Builder{})
	if err != nil {
		t.Fatal(err)
	}
	w.slateBinary = buildTestSlateBinary(t)
	w.sleep = func(context.Context, time.Duration) {}

	err = w.run(context.Background())
	if err == nil {
		t.Fatal("the watcher kept going after a terminal monitoring failure")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Fatalf("error = %v, want it to name the terminal response", err)
	}
	if launches != 1 {
		t.Fatalf("executors launched = %d, want the watcher to stop after the first", launches)
	}
}

// TestARecoverableFailureIsNotTerminal keeps the other half honest: a local
// setup problem should still be retried.
func TestARecoverableFailureIsNotTerminal(t *testing.T) {
	for _, test := range []struct {
		name        string
		err         error
		recoverable bool
	}{
		{"disk problem", errors.New("mkdir: read-only file system"), true},
		{"rate limited", &APIError{Status: http.StatusTooManyRequests}, true},
		{"internal server error", &APIError{Status: http.StatusInternalServerError}, true},
		{"gateway", &APIError{Status: http.StatusBadGateway}, true},
		{"task deleted", &APIError{Status: http.StatusNotFound}, false},
		{"credential revoked", &APIError{Status: http.StatusUnauthorized}, false},
		{"group survived", fmt.Errorf("run x left a group: %w", errGroupSurvived), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := recoverableAttemptError(test.err); got != test.recoverable {
				t.Fatalf("recoverable = %v, want %v", got, test.recoverable)
			}
		})
	}
}

// TestCleanRefusesARunBeingLaunched covers the gap between writing a run's
// record and recording its process group. The worktree exists and no group is
// recorded yet, so a naive liveness check reads it as inactive.
func TestCleanRefusesARunBeingLaunched(t *testing.T) {
	executor := writeExecutor(t, "unused-launching", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	runID, err := newRunID()
	if err != nil {
		t.Fatal(err)
	}
	worktree, branch, err := createRunWorktree(context.Background(), w.source, "codex", testTaskID, runID)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := openRegistry()
	if err != nil {
		t.Fatal(err)
	}
	// Exactly the record a watcher writes just before it starts the executor.
	launching := runRecord{
		RunID: runID, Profile: "codex", TaskID: testTaskID, Branch: branch, Worktree: worktree,
		SourceRepository: w.source.Root, State: runStateLaunching, WatcherPID: os.Getpid(),
	}
	if err := registry.save(launching); err != nil {
		t.Fatal(err)
	}
	if err := cleanRun(context.Background(), runID); err == nil {
		t.Fatal("clean removed a worktree an executor may already be running in")
	} else if !strings.Contains(err.Error(), "still running") {
		t.Fatalf("error = %v, want it to name the running watcher", err)
	}
	if _, statErr := os.Stat(worktree); statErr != nil {
		t.Fatalf("clean deleted the worktree anyway: %v", statErr)
	}

	// The same record from a watcher that is gone is releasable.
	launching.WatcherPID = 1 << 30
	if err := registry.save(launching); err != nil {
		t.Fatal(err)
	}
	if err := cleanRun(context.Background(), runID); err != nil {
		t.Fatalf("clean refused a crashed watcher's run: %v", err)
	}
}
