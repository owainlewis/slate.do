package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const resilienceTestRunID = "9f1d0a2c-8b3e-4c1a-9d5f-2e6b7c8a9d01"

func mutationRecordingServer(t *testing.T, status int, response string) (*httptest.Server, *[]string) {
	t.Helper()
	var recorded []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recorded = append(recorded, r.Method+" "+r.URL.RequestURI())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(response))
	}))
	t.Cleanup(server.Close)
	return server, &recorded
}

// fixedRandom makes jitter exact so bounds can be asserted rather than sampled.
func fixedRandom(value float64) func() float64 {
	return func() float64 { return value }
}

func TestIdleWaitsDoubleToTheCeilingAndStayInBounds(t *testing.T) {
	low, high := healthyIdleBounds()
	if low != 5*time.Second || high != 72*time.Second {
		t.Fatalf("healthy idle bounds = %s to %s, want 5s to 72s", low, high)
	}

	// With no jitter the sequence is exactly the documented doubling.
	plain := newBackoff()
	plain.random = fixedRandom(0)
	want := []time.Duration{5, 10, 20, 40, 60, 60, 60}
	for index, seconds := range want {
		got := plain.next()
		if got != time.Duration(seconds)*time.Second {
			t.Fatalf("wait %d = %s, want %ds", index, got, seconds)
		}
	}

	// At full jitter every wait sits at the top of its band, and the last one
	// is the 72 seconds the design allows.
	full := newBackoff()
	full.random = fixedRandom(1)
	var last time.Duration
	for i := 0; i < 10; i++ {
		last = full.next()
		if last < low || last > high {
			t.Fatalf("wait %d = %s, outside the %s to %s band", i, last, low, high)
		}
	}
	if last != 72*time.Second {
		t.Fatalf("settled wait = %s, want 72s", last)
	}

	// Real jitter stays in the band too.
	live := newBackoff()
	for i := 0; i < 200; i++ {
		wait := live.next()
		if wait < low || wait > high {
			t.Fatalf("wait %d = %s, outside the %s to %s band", i, wait, low, high)
		}
	}

	plain.reset()
	if got := plain.next(); got != 5*time.Second {
		t.Fatalf("wait after reset = %s, want the base 5s", got)
	}
}

func TestRetryDecisionsFollowTheStatus(t *testing.T) {
	cases := []struct {
		name      string
		err       error
		retryable bool
		wait      time.Duration
	}{
		{"connection failure", errors.New("dial tcp: connection refused"), true, 5 * time.Second},
		{"gateway", &APIError{Status: http.StatusBadGateway}, true, 5 * time.Second},
		{"unavailable", &APIError{Status: http.StatusServiceUnavailable}, true, 5 * time.Second},
		{"gateway timeout", &APIError{Status: http.StatusGatewayTimeout}, true, 5 * time.Second},
		{"rate limited without a hint", &APIError{Status: http.StatusTooManyRequests}, true, 5 * time.Second},
		{"rate limited with delta seconds", &APIError{Status: http.StatusTooManyRequests, RetryAfter: "42"}, true, 42 * time.Second},
		{"rate limited with an http date", &APIError{Status: http.StatusTooManyRequests, RetryAfter: "Wed, 21 Oct 2015 07:28:00 GMT"}, true, 5 * time.Second},
		{"rate limited with an absurd hint", &APIError{Status: http.StatusTooManyRequests, RetryAfter: "999999"}, true, maxRetryAfter},
		{"bad request", &APIError{Status: http.StatusBadRequest}, false, 0},
		{"unauthorized", &APIError{Status: http.StatusUnauthorized}, false, 0},
		{"forbidden", &APIError{Status: http.StatusForbidden}, false, 0},
		{"not found", &APIError{Status: http.StatusNotFound}, false, 0},
		{"conflict", &APIError{Status: http.StatusConflict}, false, 0},
		{"internal error", &APIError{Status: http.StatusInternalServerError}, true, 5 * time.Second},
		{"a teapot", &APIError{Status: http.StatusTeapot}, false, 0},
		{"a reply that is not the API's", &responseFormatError{Status: 200}, false, 0},
		{"the caller stopped", context.Canceled, false, 0},
		{"a client timeout", fmt.Errorf("Get \"http://x\": %w", context.DeadlineExceeded), true, 5 * time.Second},
		{"an unusable base URL", &requestBuildError{err: errors.New("unsupported protocol scheme")}, false, 0},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			failure := newBackoff()
			failure.random = fixedRandom(0)
			wait, retryable := retryDelay(test.err, failure)
			if retryable != test.retryable {
				t.Fatalf("retryable = %v, want %v", retryable, test.retryable)
			}
			if retryable && wait != test.wait {
				t.Fatalf("wait = %s, want %s", wait, test.wait)
			}
		})
	}
}

// TestAReadRecoversWithoutStartingARun proves a server blip does not terminate
// the watcher and does not create a run or a worktree while it is failing.
func TestAReadRecoversWithoutStartingARun(t *testing.T) {
	executor := writeExecutor(t, "unused-resilience", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.failure.random = fixedRandom(0)

	var waits []time.Duration
	w.sleep = func(ctx context.Context, d time.Duration) { waits = append(waits, d) }

	attempts := 0
	err = w.retryRead(context.Background(), "look for assigned work", func() error {
		attempts++
		switch attempts {
		case 1:
			return errors.New("dial tcp: connection refused")
		case 2:
			return &APIError{Status: http.StatusServiceUnavailable}
		case 3:
			// Shorter than where the sequence has reached, so the sequence
			// wins: a hint may delay the next request, never hurry it.
			return &APIError{Status: http.StatusTooManyRequests, RetryAfter: "7"}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("retryRead = %v, want recovery", err)
	}
	if attempts != 4 {
		t.Fatalf("attempts = %d, want three failures then a success", attempts)
	}
	want := []time.Duration{5 * time.Second, 10 * time.Second, 20 * time.Second}
	if len(waits) != len(want) {
		t.Fatalf("waits = %v, want %v", waits, want)
	}
	for index, expected := range want {
		if waits[index] != expected {
			t.Fatalf("wait %d = %s, want %s (%v)", index, waits[index], expected, waits)
		}
	}
	// A success clears the failure sequence, so the next problem starts at the
	// base rather than where the last one left off.
	if next := w.failure.next(); next != 5*time.Second {
		t.Fatalf("wait after recovery = %s, want the base 5s", next)
	}
	if records := fixture.runs(t); len(records) != 0 {
		t.Fatalf("a failing read created %d runs", len(records))
	}
}

func TestCancelDuringWorkingTaskRetryStopsCleanly(t *testing.T) {
	executor := writeExecutor(t, "unused-cancel-working", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(out http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/v1/agent/tasks" && request.URL.Query().Get("status") == "working" {
			out.Header().Set("Content-Type", "application/json")
			out.WriteHeader(http.StatusServiceUnavailable)
			_, _ = out.Write([]byte(`{"error":"unavailable"}`))
			return
		}
		fixture.fake.serve(out, request)
	}))
	t.Cleanup(server.Close)
	w.client = client{baseURL: server.URL, http: server.Client()}
	w.workingScopeChecked = false

	ctx, cancel := context.WithCancel(context.Background())
	w.sleep = func(context.Context, time.Duration) { cancel() }
	if err := w.run(ctx); err != nil {
		t.Fatalf("run after cancellation = %v, want a clean stop", err)
	}
}

func TestMonitoringBackoffGrowsWhenOnlyEntriesKeepFailing(t *testing.T) {
	executor := writeExecutor(t, "unused-entry-failure", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	server := httptest.NewServer(http.HandlerFunc(func(out http.ResponseWriter, request *http.Request) {
		if strings.HasSuffix(request.URL.Path, "/entries") && request.Method == http.MethodGet {
			out.Header().Set("Content-Type", "application/json")
			out.WriteHeader(http.StatusServiceUnavailable)
			_, _ = out.Write([]byte(`{"error":"unavailable"}`))
			return
		}
		fixture.fake.serve(out, request)
	}))
	t.Cleanup(server.Close)

	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.client = client{baseURL: server.URL, http: server.Client()}
	w.failure.random = fixedRandom(0)
	supervision := &runSupervision{}
	want := []time.Duration{5, 10, 20, 40, 60}
	for index, seconds := range want {
		_, decided, err := w.inspectRun(context.Background(), supervision, testTaskID, resilienceTestRunID, false, func() bool { return true })
		if decided || err == nil {
			t.Fatalf("inspection %d: decided=%v err=%v, want a retryable entries failure", index, decided, err)
		}
		wait, retryable := retryDelay(err, w.failure)
		if !retryable || wait != seconds*time.Second {
			t.Fatalf("inspection %d: retryable=%v wait=%s, want true and %ds", index, retryable, wait, seconds)
		}
	}
}

func TestUnsupportedBaseURLIsTerminalBeforeTransport(t *testing.T) {
	c := client{baseURL: "ftp://example.invalid", token: "test", http: http.DefaultClient}
	_, err := c.agentTasks("queued", "", 1)
	if err == nil {
		t.Fatal("ftp base URL succeeded")
	}
	var buildErr *requestBuildError
	if !errors.As(err, &buildErr) {
		t.Fatalf("error = %T %v, want requestBuildError", err, err)
	}
	if retryableError(err) {
		t.Fatalf("unsupported base URL was classified as retryable: %v", err)
	}
}

func TestATerminalReadStopsWithAnActionableError(t *testing.T) {
	executor := writeExecutor(t, "unused-terminal", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.sleep = func(context.Context, time.Duration) { t.Fatal("a terminal error waited before giving up") }

	err = w.retryRead(context.Background(), "look for assigned work", func() error {
		return &APIError{Status: http.StatusUnauthorized, Code: "unauthorized", Message: "authentication required"}
	})
	if err == nil {
		t.Fatal("a terminal error was retried")
	}
	for _, expected := range []string{"look for assigned work", "401", "authentication required"} {
		if !strings.Contains(err.Error(), expected) {
			t.Fatalf("error %q does not mention %q", err, expected)
		}
	}
}

// TestIdleAndFailureWaitsAreIndependent pins the rule that recovering from one
// does not reset the other.
func TestIdleAndFailureWaitsAreIndependent(t *testing.T) {
	executor := writeExecutor(t, "unused-independent", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.idle.random = fixedRandom(0)
	w.failure.random = fixedRandom(0)
	w.sleep = func(context.Context, time.Duration) {}

	// The server has been failing for a while.
	for i := 0; i < 3; i++ {
		w.failure.next()
	}
	// An idle poll that reaches the server does not undo that.
	if got := w.idle.next(); got != 5*time.Second {
		t.Fatalf("first idle wait = %s, want 5s", got)
	}
	if got := w.failure.next(); got != 40*time.Second {
		t.Fatalf("failure wait = %s, want the sequence to continue at 40s", got)
	}
	// And a successful read resets the failure sequence without touching idle.
	if err := w.retryRead(context.Background(), "read", func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if got := w.failure.next(); got != 5*time.Second {
		t.Fatalf("failure wait after recovery = %s, want 5s", got)
	}
	if got := w.idle.next(); got != 10*time.Second {
		t.Fatalf("idle wait = %s, want the idle sequence to have continued to 10s", got)
	}
}

// TestFindingWorkResetsTheIdleWait drives the real loop: after a long quiet
// spell, completing a task must bring the watcher back to a short interval
// rather than leaving it minutes away from noticing the next one.
func TestFindingWorkResetsTheIdleWait(t *testing.T) {
	executor := writeExecutor(t, "resetting-codex", fmt.Sprintf(`
cat >/dev/null
"$SLATE_BIN" tasks claim %s >/dev/null || exit 1
"$SLATE_BIN" tasks output %s --body "Done." --idempotency-key "out" >/dev/null
`, testTaskID, testTaskID))
	fixture := newWatcherFixture(t, executor)
	// Nothing to do at first.
	fixture.fake.status = "needs_review"

	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	w.slateBinary = buildTestSlateBinary(t)
	w.idle.random = fixedRandom(0)
	w.failure.random = fixedRandom(0)

	var waits []time.Duration
	ctx, cancel := context.WithCancel(context.Background())
	w.sleep = func(_ context.Context, d time.Duration) {
		waits = append(waits, d)
		switch len(waits) {
		case 3:
			// Work appears after three quiet rounds, each longer than the last.
			fixture.fake.mu.Lock()
			fixture.fake.status = "queued"
			fixture.fake.mu.Unlock()
		case 4:
			// The run has finished and the queue is quiet again.
			cancel()
		}
	}
	if err := w.run(ctx); err != nil {
		t.Fatal(err)
	}
	if len(waits) < 4 {
		t.Fatalf("waits = %v, want three quiet rounds, a task, then another quiet round", waits)
	}
	if waits[0] != 5*time.Second || waits[1] != 10*time.Second || waits[2] != 20*time.Second {
		t.Fatalf("quiet waits = %v, want the idle sequence to grow", waits[:3])
	}
	// Without the reset this would be 40 seconds, the next step of the
	// sequence the quiet spell had reached.
	if waits[3] != 5*time.Second {
		t.Fatalf("wait after completing a task = %s, want the idle sequence reset to 5s (%v)", waits[3], waits)
	}
	if _, _, entries, _ := fixture.fake.snapshot(); entries != 1 {
		t.Fatalf("entries = %d, want the task to have been completed", entries)
	}
}

// TestTheWatcherNeverRetriesAMutation proves the CLI's write commands make
// exactly one request each, whatever the server answers. Repeating a write is
// the agent's decision, made with its own idempotency key.
func TestTheWatcherNeverRetriesAMutation(t *testing.T) {
	for _, status := range []int{http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			server, recorded := mutationRecordingServer(t, status, `{"code":"rate_limit_exceeded","error":"Too many requests."}`)
			c := client{baseURL: server.URL, token: "test", runID: resilienceTestRunID, http: server.Client()}
			for _, args := range [][]string{
				{"claim", "task-1"},
				{"comment", "task-1", "--body", "x", "--idempotency-key", "k"},
				{"output", "task-1", "--body", "x", "--idempotency-key", "k"},
				{"status", "task-1", "needs_review"},
				{"update", "task-1", "--title", "x"},
			} {
				before := len(*recorded)
				if err := tasksCmd(c, args); err == nil {
					t.Fatalf("%v succeeded against a %d", args, status)
				}
				if sent := len(*recorded) - before; sent != 1 {
					t.Fatalf("%v sent %d requests, want exactly one", args, sent)
				}
			}
		})
	}
}

// TestMonitoringWaitsOutARateLimit came from a real run: the watcher polled a
// rate-limited server every 250ms and made the rate limit worse, because the
// backoff only covered the queue read and not the monitoring reads.
func TestMonitoringWaitsOutARateLimit(t *testing.T) {
	executor := writeExecutor(t, "waiting-codex", "cat >/dev/null\nsleep 1\n")
	fixture := newWatcherFixture(t, executor)
	base := fixture.fake
	limited := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The limit lifts after a few refusals, the way a real one would.
		if strings.HasPrefix(r.URL.Path, "/api/v1/tasks/") && r.Method == http.MethodGet && limited < 3 {
			limited++
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "30")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"code":"rate_limit_exceeded","error":"Too many requests."}`))
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

	var waits []time.Duration
	// Scaled down so the test is quick, while still pacing the loop.
	w.sleep = func(_ context.Context, d time.Duration) {
		waits = append(waits, d)
		time.Sleep(20 * time.Millisecond)
	}

	if _, err := w.attempt(context.Background(), fixture.fake.queued[0]); err != nil {
		t.Fatal(err)
	}
	// Before the fix the monitoring loop never called sleep at all: it used its
	// own fixed interval and ignored what the server asked for.
	if len(waits) == 0 {
		t.Fatal("a rate-limited monitoring read did not wait at all")
	}
	for index, wait := range waits {
		if wait != 30*time.Second {
			t.Fatalf("wait %d = %s, want the 30s the server asked for", index, wait)
		}
	}
	if limited != 3 {
		t.Fatalf("rate-limited reads = %d, want the watcher to have waited each one out", limited)
	}
}

// TestAZeroRetryAfterCannotSpin covers a hint of zero, which a misconfigured
// proxy can send. Honouring it literally turns a rate limit into a flood.
func TestAZeroRetryAfterCannotSpin(t *testing.T) {
	for _, hint := range []string{"0", "1", ""} {
		t.Run("hint "+hint, func(t *testing.T) {
			failure := newBackoff()
			failure.random = fixedRandom(0)
			wait, retryable := retryDelay(&APIError{Status: http.StatusTooManyRequests, RetryAfter: hint}, failure)
			if !retryable {
				t.Fatal("a rate limit was treated as terminal")
			}
			if wait < backoffBase {
				t.Fatalf("wait = %s, want at least the base %s so the sequence advances", wait, backoffBase)
			}
		})
	}
	// A hint longer than the sequence is still honoured.
	failure := newBackoff()
	failure.random = fixedRandom(0)
	wait, _ := retryDelay(&APIError{Status: http.StatusTooManyRequests, RetryAfter: "45"}, failure)
	if wait != 45*time.Second {
		t.Fatalf("wait = %s, want the 45s the server asked for", wait)
	}
	// Repeated refusals advance rather than repeating the same short wait.
	advancing := newBackoff()
	advancing.random = fixedRandom(0)
	var seen []time.Duration
	for i := 0; i < 3; i++ {
		w, _ := retryDelay(&APIError{Status: http.StatusTooManyRequests, RetryAfter: "0"}, advancing)
		seen = append(seen, w)
	}
	if !(seen[0] < seen[1] && seen[1] < seen[2]) {
		t.Fatalf("waits = %v, want every step to grow under a zero hint", seen)
	}
}

// TestAnInterruptStopsCleanly covers Ctrl-C, which is how a watcher is stopped.
func TestAnInterruptStopsCleanly(t *testing.T) {
	executor := writeExecutor(t, "unused-interrupt", "cat >/dev/null\n")
	fixture := newWatcherFixture(t, executor)
	w, err := fixture.newWatcher(t)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err = w.retryRead(ctx, "look for assigned work", func() error {
		return errors.New("dial tcp: connection refused")
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want the cancellation", err)
	}

	// The loop treats it as a clean stop rather than a failure.
	fixture.fake.mu.Lock()
	fixture.fake.status = "needs_review"
	fixture.fake.mu.Unlock()
	stopped, stop := context.WithCancel(context.Background())
	w.sleep = func(context.Context, time.Duration) { stop() }
	if err := w.run(stopped); err != nil {
		t.Fatalf("run after an interrupt = %v, want a clean stop", err)
	}
}

// TestAFinishedRunStopsWhenTheServerWillNotAnswer covers the case my first
// attempt at exit detection missed: the retry path looped back without ever
// reaching the exit check, so a dead run was polled for ever.
func TestAFinishedRunStopsWhenTheServerWillNotAnswer(t *testing.T) {
	executor := writeExecutor(t, "quick-exit", "cat >/dev/null\nexit 0\n")
	fixture := newWatcherFixture(t, executor)
	base := fixture.fake
	reads := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/tasks/") && r.Method == http.MethodGet {
			reads++
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":"unavailable"}`))
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

	done := make(chan string, 1)
	go func() {
		state, _ := w.attempt(context.Background(), fixture.fake.queued[0])
		done <- state
	}()
	select {
	case state := <-done:
		if state != runStateInterrupted {
			t.Fatalf("state = %q, want interrupted once the run is gone", state)
		}
	case <-time.After(20 * time.Second):
		t.Fatalf("the watcher polled a finished run for ever (%d reads)", reads)
	}
	records := fixture.runs(t)
	if len(records) != 1 || !records[0].retained() {
		t.Fatalf("records = %+v, want the run retained", records)
	}
}

// TestAnInterruptMidReadIsRecordedAsInterrupted covers Ctrl-C arriving while a
// monitoring request is in flight, which took the failure branch before.
func TestAnInterruptMidReadIsRecordedAsInterrupted(t *testing.T) {
	executor := writeExecutor(t, "slow-exit", "cat >/dev/null\nsleep 5\n")
	fixture := newWatcherFixture(t, executor)
	base := fixture.fake
	release := make(chan struct{})
	var once sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/tasks/") && r.Method == http.MethodGet {
			once.Do(func() { close(release) })
			<-r.Context().Done()
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
	out := &strings.Builder{}
	w.out = out

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-release
		time.Sleep(150 * time.Millisecond)
		cancel()
	}()
	state, err := w.attempt(ctx, fixture.fake.queued[0])
	if err != nil {
		t.Fatalf("attempt = %v, want a clean interrupt", err)
	}
	if state != runStateInterrupted {
		t.Fatalf("state = %q, want interrupted rather than an unplaceable run", state)
	}
	if strings.Contains(out.String(), "could not tell whether") {
		t.Fatalf("an ordinary stop was reported as a failure:\n%s", out.String())
	}
}

func TestRetryableErrorIsTheOnlyClassifier(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want bool
	}{
		{"connection failure", errors.New("dial tcp: refused"), true},
		{"rate limited", &APIError{Status: http.StatusTooManyRequests}, true},
		{"internal error", &APIError{Status: http.StatusInternalServerError}, true},
		{"not found", &APIError{Status: http.StatusNotFound}, false},
		{"a reply that is not the API's", &responseFormatError{Status: 200}, false},
		{"the caller stopped", context.Canceled, false},
		{"a client timeout", fmt.Errorf("Get: %w", context.DeadlineExceeded), true},
		{"an unusable base URL", &requestBuildError{err: errors.New("bad scheme")}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := retryableError(test.err); got != test.want {
				t.Fatalf("retryableError = %v, want %v", got, test.want)
			}
			// retryDelay must agree, since it is the same question.
			_, retryable := retryDelay(test.err, newBackoff())
			if retryable != test.want {
				t.Fatalf("retryDelay disagrees: %v, want %v", retryable, test.want)
			}
		})
	}
}

// TestTheLoopAndTheReadsAgreeOnWhatIsTerminal stops the two classifications
// drifting: an error that is terminal for a read must not be recoverable for
// the loop, or the watcher stops the executor and then starts another.
func TestTheLoopAndTheReadsAgreeOnWhatIsTerminal(t *testing.T) {
	for _, err := range []error{
		errors.New("dial tcp: refused"),
		&APIError{Status: http.StatusTooManyRequests},
		&APIError{Status: http.StatusInternalServerError},
		&APIError{Status: http.StatusNotFound},
		&APIError{Status: http.StatusUnauthorized},
		&responseFormatError{Status: 200},
		&requestBuildError{err: errors.New("bad scheme")},
		fmt.Errorf("Get: %w", context.DeadlineExceeded),
	} {
		if got, want := recoverableAttemptError(err), retryableError(err); got != want {
			t.Errorf("%v: loop says recoverable=%v, reads say retryable=%v", err, got, want)
		}
	}
	// A group that would not stop is terminal for the loop whatever the reads say.
	if recoverableAttemptError(fmt.Errorf("wrapped: %w", errGroupSurvived)) {
		t.Fatal("a surviving process group was treated as recoverable")
	}
}

// TestAFinishedRunIsGivenAFewMoreReads covers an output posted just before the
// executor exits while the API is briefly unavailable. Declaring the run
// interrupted at the first failure would lose a result that did happen.
func TestAFinishedRunIsGivenAFewMoreReads(t *testing.T) {
	executor := writeExecutor(t, "reporting-then-exit", fmt.Sprintf(`
cat >/dev/null
"$SLATE_BIN" tasks claim %s >/dev/null || exit 1
"$SLATE_BIN" tasks output %s --body "Done." --idempotency-key "out" >/dev/null
exit 0
`, testTaskID, testTaskID))
	fixture := newWatcherFixture(t, executor)
	base := fixture.fake
	// The task read fails a few times right after the run finishes, then works.
	failures := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/tasks/") && r.Method == http.MethodGet {
			if _, _, entries, _ := base.snapshot(); entries > 0 && failures < 3 {
				failures++
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"error":"unavailable"}`))
				return
			}
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

	state, err := w.attempt(context.Background(), fixture.fake.queued[0])
	if err != nil {
		t.Fatal(err)
	}
	if state != runStateSuccess {
		t.Fatalf("state = %q, want the output to be found once the server answered", state)
	}
	if failures == 0 {
		t.Fatal("the server never failed, so nothing was exercised")
	}
}
