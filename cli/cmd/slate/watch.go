package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// Outcomes of one attempt. Only the retained three keep a worktree.
const (
	// outcomeLostRace means another run owns the task. The worktree is
	// disposable and the watcher may offer the next candidate.
	outcomeLostRace = "lost_race"
	// outcomeNeverClaimed means nobody holds the task and this run did not
	// claim it, so the executor itself failed. Retrying immediately would spin.
	outcomeNeverClaimed = "never_claimed"
)

const (
	// pollInterval is how often an idle watcher asks for work and how often an
	// active one checks its run. Backoff arrives with the resilience work.
	pollInterval = 5 * time.Second
	// firstObservationInterval is used until a run is first seen to own or
	// write to its task. Ownership is erased by any later workflow transition,
	// so the sooner it is witnessed the smaller the window in which a claimed
	// run could be mistaken for one that never claimed.
	firstObservationInterval = 250 * time.Millisecond
	// exitGrace is how long a finished executor is given to leave on its own
	// before its process group is signalled.
	exitGrace = 10 * time.Second
	// launchFailureLimit stops a watcher that cannot create local runs, rather
	// than spinning against a broken disk or repository.
	launchFailureLimit = 5
	// postExitReadAttempts is how many times a failing read is retried after the
	// executor has gone, before the run is recorded as interrupted.
	postExitReadAttempts = 5
)

type watchOptions struct {
	profileName string
	listID      string
	workdir     string
}

// watcher owns isolation, dispatch, monitoring, and cleanup. It never claims a
// task, writes a card entry, or judges the work: those belong to the executor.
type watcher struct {
	client       client
	profileName  string
	profile      profile
	identity     identity
	listID       string
	source       sourceCheckout
	registry     *registry
	slateBinary  string
	executorPath string
	out          io.Writer
	now          func() time.Time
	sleep        func(context.Context, time.Duration)
	// newWatcher checks the working-task guard once before returning. The run
	// loop consumes that check for its first round, then repeats it before each
	// later offer because another task may have started in the meantime.
	workingScopeChecked bool
	// idle waits between polls that found nothing; failure waits out a server
	// that cannot answer. They are separate because finding work and reaching
	// the server are different things to recover from, and recovering from one
	// should not reset the other.
	idle    *backoff
	failure *backoff
}

func watchCmd(c client, args []string) error {
	if wantsHelp(args) {
		return printHelp("watch")
	}
	fs := newFlagSet("watch")
	profileName := fs.String("profile", "", "configured profile to run")
	listID := fs.String("list", "", "limit to one list")
	workdir := fs.String("workdir", ".", "source Git checkout")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("unexpected arguments; run 'slate help watch'")
	}
	if strings.TrimSpace(*listID) != "" && !validUUID(strings.TrimSpace(*listID)) {
		return errors.New("--board must be a valid board ID")
	}
	options := watchOptions{
		profileName: strings.TrimSpace(*profileName),
		listID:      strings.TrimSpace(*listID),
		workdir:     *workdir,
	}
	// Setpgid takes the executor out of the terminal's foreground group, so
	// Ctrl-C no longer reaches it. The watcher has to forward that itself or a
	// stopped watcher would leave the agent running detached.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	w, err := newWatcher(ctx, c, options, os.Stdout)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			// Interrupting a startup that is waiting out an unreachable server
			// is how someone abandons it, not a failure.
			return nil
		}
		return err
	}
	return w.run(ctx)
}

// newWatcher performs every check that must pass before any worktree exists or
// any executor starts. An identity or credential problem must never leave local
// state behind.
func newWatcher(ctx context.Context, c client, options watchOptions, out io.Writer) (*watcher, error) {
	if !processGroupsSupported {
		return nil, errors.New("slate watch runs on macOS and Linux, where a whole executor process group can be stopped")
	}
	selected, err := loadProfile(options.profileName)
	if err != nil {
		return nil, err
	}
	token, err := selected.token()
	if err != nil {
		return nil, err
	}
	c.token = token
	c.runID = ""

	binary, err := resolveSlateBinary()
	if err != nil {
		return nil, err
	}
	executorPath, err := exec.LookPath(selected.Command[0])
	if err != nil {
		return nil, fmt.Errorf("executor %q is not on PATH: %w", selected.Command[0], err)
	}
	executorPath, err = filepath.Abs(executorPath)
	if err != nil {
		return nil, err
	}

	var who identity
	startupFailure := newBackoff()
	if err := retryReadWith(ctx, startupFailure, sleepContext, func(format string, args ...any) {
		fmt.Fprintf(out, format+"\n", args...)
	}, "verify the profile credential", func() error {
		found, err := c.withContext(ctx).identity()
		if err != nil {
			return err
		}
		who = found
		return nil
	}); err != nil {
		return nil, err
	}
	if !who.Authenticated || who.User.AgentID == "" {
		return nil, fmt.Errorf("%s holds a personal credential; a watcher needs an agent token", selected.TokenEnv)
	}
	if !strings.EqualFold(who.User.AgentID, selected.AgentID) {
		return nil, fmt.Errorf("%s belongs to agent %s, but profile %q expects %s",
			selected.TokenEnv, who.User.AgentID, options.profileName, selected.AgentID)
	}
	if !who.Capabilities.ManagedRuns {
		return nil, errors.New("this Slate server does not support managed runs yet; deploy the server before running a watcher")
	}

	source, err := openSourceCheckout(ctx, options.workdir)
	if err != nil {
		return nil, err
	}
	runs, err := openRegistry()
	if err != nil {
		return nil, err
	}
	retained, err := runs.retainedCount(options.profileName)
	if err != nil {
		return nil, err
	}
	if retained >= maxRetainedRuns {
		return nil, fmt.Errorf("profile %q is holding %d retained worktrees, the limit; inspect them with 'slate runs list --profile %s' and release one with 'slate runs clean <run-id>'",
			options.profileName, retained, options.profileName)
	}

	w := &watcher{
		client:       c,
		profileName:  options.profileName,
		profile:      selected,
		identity:     who,
		listID:       options.listID,
		source:       source,
		registry:     runs,
		slateBinary:  binary,
		executorPath: executorPath,
		out:          out,
		now:          time.Now,
		sleep:        sleepContext,
		idle:         newBackoff(),
		failure:      newBackoff(),
	}
	if err := w.refuseWhileWorkTaskExists(ctx); err != nil {
		return nil, err
	}
	w.workingScopeChecked = true
	return w, nil
}

// refuseWhileWorkTaskExists stops a second run against work already in
// progress. The first version has no resume, so a person decides what happens
// to an in-flight task.
func (w *watcher) refuseWhileWorkTaskExists(ctx context.Context) error {
	var working []taskView
	err := w.retryRead(ctx, "check for work already in progress", func() error {
		found, err := w.client.withContext(ctx).agentTasks("working", w.listID, 1)
		if err != nil {
			return err
		}
		working = found
		return nil
	})
	if err != nil {
		return err
	}
	if len(working) > 0 {
		scope := "any visible board"
		if w.listID != "" {
			scope = "list " + w.listID
		}
		return fmt.Errorf("task %s (%q) is already in progress on %s; finish it or move it back to Ready before watching",
			working[0].ID, working[0].Title, scope)
	}
	return nil
}

// resolveSlateBinary finds the exact binary that is running, so the prompt can
// name it and an unrelated slate earlier on PATH cannot be used instead.
func resolveSlateBinary() (string, error) {
	binary, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("could not resolve the running slate binary: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(binary); err == nil {
		binary = resolved
	}
	return filepath.Abs(binary)
}

func (w *watcher) logf(format string, args ...any) {
	fmt.Fprintf(w.out, format+"\n", args...)
}

func (w *watcher) run(ctx context.Context) error {
	w.logf("Watching as %s (%s) from %s on %s.", w.identity.User.DisplayName, w.identity.User.AgentID, w.source.Root, w.source.Branch)
	if w.listID != "" {
		w.logf("Scoped to list %s.", w.listID)
	}
	launchFailures := 0
	for {
		if ctx.Err() != nil {
			return nil
		}
		if w.workingScopeChecked {
			w.workingScopeChecked = false
		} else if err := w.refuseWhileWorkTaskExists(ctx); err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			return err
		}
		// Retention is re-checked every round, not only at startup, because a
		// long session keeps a worktree for every task it finishes.
		retained, err := w.registry.retainedCount(w.profileName)
		if err != nil {
			return err
		}
		if retained >= maxRetainedRuns {
			return fmt.Errorf("profile %q is holding %d retained worktrees, the limit; release one with 'slate runs clean <run-id>' to continue",
				w.profileName, retained)
		}
		var candidates []taskView
		err = w.retryRead(ctx, "look for assigned work", func() error {
			found, err := w.client.withContext(ctx).agentTasks("queued", w.listID, 1)
			if err != nil {
				return err
			}
			candidates = found
			return nil
		})
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			return err
		}
		if len(candidates) == 0 {
			w.sleep(ctx, w.idle.next())
			continue
		}
		// Work resets only the idle wait. A server that has been failing stays
		// on its own recovery schedule.
		w.idle.reset()
		outcome, err := w.attempt(ctx, candidates[0])
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			if !recoverableAttemptError(err) {
				// The server has answered in a way that repeating cannot
				// change, or a process could not be stopped. Either way the
				// next candidate must not start.
				return err
			}
			launchFailures++
			w.logf("Could not start a run for task %s: %v", candidates[0].ID, err)
			if launchFailures >= launchFailureLimit {
				return fmt.Errorf("stopped after %d consecutive local launch failures", launchFailures)
			}
			w.sleep(ctx, pollInterval)
			continue
		}
		switch outcome {
		case runStateSuccess:
			launchFailures = 0
		case outcomeLostRace:
			// Losing a race is normal, but pausing first keeps two watchers
			// from trading claims as fast as they can start executors.
			launchFailures = 0
			w.sleep(ctx, pollInterval)
		case runStateAmbiguous:
			// The run could not be placed, so its worktree is kept for
			// inspection, but there is nothing to stop for.
			launchFailures = 0
			w.sleep(ctx, pollInterval)
		case outcomeNeverClaimed:
			// The executor started and then failed to claim, which usually
			// means it is misconfigured. Retrying without a limit would spawn
			// paid sessions in a loop.
			launchFailures++
			w.logf("The executor exited without claiming task %s.", candidates[0].ID)
			if launchFailures >= launchFailureLimit {
				return fmt.Errorf("stopped after %d consecutive runs that never claimed; check the profile's executor command and its Slate credential", launchFailures)
			}
			w.sleep(ctx, pollInterval)
		default:
			return nil
		}
	}
}

// attempt runs one candidate end to end and returns the state it reached.
func (w *watcher) attempt(ctx context.Context, candidate taskView) (string, error) {
	runID, err := newRunID()
	if err != nil {
		return "", err
	}
	worktree, branch, err := createRunWorktree(ctx, w.source, w.profileName, candidate.ID, runID)
	if err != nil {
		return "", err
	}
	record := runRecord{
		RunID: runID, Profile: w.profileName, AgentID: w.identity.User.AgentID,
		TaskID: candidate.ID, Branch: branch, Worktree: worktree,
		SourceRepository: w.source.Root, SourceCommit: w.source.Commit, State: runStateLaunching,
		WatcherPID: os.Getpid(),
	}
	if err := w.registry.save(record); err != nil {
		if cleanupErr := discardRunWorktree(ctx, w.source.Root, worktree, branch); cleanupErr != nil {
			record.State = runStateAmbiguous
			if retainErr := w.registry.save(record); retainErr != nil {
				return runStateAmbiguous, fmt.Errorf("%w: record run %s: %v; cleanup also failed: %v; retaining %s on %s also failed: %v",
					errUndiscoverableRun, runID, err, cleanupErr, worktree, branch, retainErr)
			}
			return runStateAmbiguous, fmt.Errorf("record run %s: %w; cleanup also failed, so it remains in 'slate runs list': %v", runID, err, cleanupErr)
		}
		return "", err
	}
	// Several watchers can share one profile's registry, so the capacity check
	// before this point can be passed by two of them at once. The record is now
	// written, so re-counting sees every reservation and one of them backs out.
	// Nothing has been launched yet, so backing out costs nothing.
	if retained, err := w.registry.retainedCount(w.profileName); err == nil && retained > maxRetainedRuns {
		if cleanupErr := discardRunWorktree(ctx, w.source.Root, worktree, branch); cleanupErr != nil {
			record.State = runStateAmbiguous
			if saveErr := w.registry.save(record); saveErr != nil {
				w.logf("Could not record retained run %s after cleanup failed: %v", runID, saveErr)
			}
			return runStateAmbiguous, fmt.Errorf("profile %q exceeded its worktree limit and run %s could not be removed; it remains in 'slate runs list': %w",
				w.profileName, runID, cleanupErr)
		}
		if err := w.registry.remove(runID); err != nil {
			return "", fmt.Errorf("%w: remove run %s after releasing its over-limit worktree: %v", errRunRecordRemoval, runID, err)
		}
		return "", fmt.Errorf("profile %q is holding %d worktrees, over the limit of %d; release one with 'slate runs clean <run-id>'",
			w.profileName, retained, maxRetainedRuns)
	}

	w.logf("Task %s (%q) offered to run %s in %s.", candidate.ID, candidate.Title, runID, worktree)
	command, err := w.startExecutor(ctx, candidate, runID, worktree, branch)
	if err != nil {
		if cleanupErr := discardRunWorktree(ctx, w.source.Root, worktree, branch); cleanupErr != nil {
			record.State = runStateAmbiguous
			if saveErr := w.registry.save(record); saveErr != nil {
				w.logf("Could not record retained run %s after launch cleanup failed: %v", runID, saveErr)
			}
			return runStateAmbiguous, fmt.Errorf("%w; run %s could not be removed and remains in 'slate runs list': %v", err, runID, cleanupErr)
		}
		if removeErr := w.registry.remove(runID); removeErr != nil {
			return "", fmt.Errorf("%w: launch failed (%v); remove released run record %s: %v", errRunRecordRemoval, err, runID, removeErr)
		}
		return "", err
	}
	processGroupID := command.Process.Pid
	record.State = runStateWorking
	record.ChildPID = command.Process.Pid
	record.ProcessGroupID = processGroupID
	if err := w.registry.save(record); err != nil {
		// The executor is already running and may have claimed the task and
		// changed files. A local bookkeeping failure is not grounds to destroy
		// that, so the worktree stays and the run is reported as unplaceable.
		// The child is reaped as well as signalled. An unreaped zombie stays in
		// its process group, so a liveness check would keep succeeding and the
		// watcher would wrongly report that the group could not be stopped.
		go func() { _ = command.Wait() }()
		cleared := w.stopProcessGroup(processGroupID)
		w.logf("Could not record run %s: %v", runID, err)
		w.logf("The executor had already started, so %s is kept on %s in case it holds work.", worktree, branch)
		if !cleared {
			return runStateAmbiguous, fmt.Errorf("run %s left a process group that did not stop; end process group %d before watching again: %w", runID, processGroupID, errGroupSurvived)
		}
		// The executor had started, so it may have claimed the task. Carrying
		// on could put a second run alongside a task that is still working.
		return runStateAmbiguous, fmt.Errorf("run %s started but could not be recorded, so watching stops; inspect %s and the task's state: %w", runID, worktree, err)
	}

	state, groupCleared, superviseErr := w.superviseRun(ctx, command, candidate.ID, runID, processGroupID)
	record.State = state
	if groupCleared {
		// The identifiers are only cleared once nothing from the run is left,
		// so a cleanup command can still refuse a live group. The answer comes
		// from supervision rather than a fresh check, because a reaped process
		// ID may already belong to somebody else.
		record.ChildPID = 0
		record.ProcessGroupID = 0
	}
	if superviseErr == nil && groupCleared && (state == outcomeLostRace || state == outcomeNeverClaimed) {
		// This run never held the task, so its worktree and branch are
		// disposable even if the executor changed them before exiting.
		if err := discardRunWorktree(ctx, w.source.Root, worktree, branch); err != nil {
			// The checkout is still on disk, so its record has to stay too, or
			// it would vanish from runs list and from the retention count with
			// nothing left to find it by.
			w.logf("Could not remove the disposable worktree %s: %v", worktree, err)
			record.State = runStateAmbiguous
			if saveErr := w.registry.save(record); saveErr != nil {
				w.logf("Could not record run %s: %v", runID, saveErr)
			}
			return runStateAmbiguous, nil
		}
		if removeErr := w.registry.remove(runID); removeErr != nil {
			return state, fmt.Errorf("%w: remove released run %s: %v", errRunRecordRemoval, runID, removeErr)
		}
		if state == outcomeLostRace {
			w.logf("Another run claimed task %s. Removed %s.", candidate.ID, worktree)
		} else {
			w.logf("Run %s never claimed task %s. Removed %s.", runID, candidate.ID, worktree)
		}
		return state, nil
	}
	if err := w.registry.save(record); err != nil {
		w.logf("Could not record run %s: %v", runID, err)
	}
	w.reportOutcome(state, candidate, runID, branch, worktree)
	if superviseErr != nil {
		return state, superviseErr
	}
	if !groupCleared {
		// One watcher runs one executor group. If this one cannot be ended,
		// starting another would break that, so the watcher stops instead.
		return state, fmt.Errorf("run %s left a process group that did not stop; end process group %d before watching again: %w", runID, processGroupID, errGroupSurvived)
	}
	return state, nil
}

// startExecutor launches the configured command in its own process group, with
// the prompt on stdin. The credential is passed in the environment only, never
// in the prompt or the arguments.
func (w *watcher) startExecutor(ctx context.Context, candidate taskView, runID string, worktree string, branch string) (*exec.Cmd, error) {
	prompt := buildPrompt(promptDetails{
		AgentID: w.identity.User.AgentID, AgentName: w.identity.User.DisplayName,
		AgentPurpose: w.identity.User.AgentPurpose,
		TaskID:       candidate.ID, TaskTitle: candidate.Title, TaskPriority: candidate.Priority,
		ListName: candidate.ListName,
		RunID:    runID, Worktree: worktree, Branch: branch,
	})
	command := exec.Command(w.executorPath, w.profile.Command[1:]...)
	command.Dir = worktree
	command.Env = w.executorEnvironment(runID)
	command.Stdin = strings.NewReader(prompt)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	useProcessGroup(command)
	if err := command.Start(); err != nil {
		return nil, fmt.Errorf("could not start %s: %w", w.executorPath, err)
	}
	return command, nil
}

// executorEnvironment gives the child exactly what it needs: its run, the exact
// Slate binary, the base URL, and the agent credential.
func (w *watcher) executorEnvironment(runID string) []string {
	binaryDir := filepath.Dir(w.slateBinary)
	env := make([]string, 0, len(os.Environ())+4)
	for _, entry := range os.Environ() {
		name, _, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		switch name {
		case "PATH", "SLATE_RUN_ID", "SLATE_BIN", "SLATE_API_TOKEN", "SLATE_BASE_URL":
			continue
		}
		env = append(env, entry)
	}
	env = append(env,
		"PATH="+binaryDir+string(os.PathListSeparator)+os.Getenv("PATH"),
		"SLATE_RUN_ID="+runID,
		"SLATE_BIN="+w.slateBinary,
		"SLATE_BASE_URL="+w.client.baseURL,
		"SLATE_API_TOKEN="+w.client.token,
	)
	return env
}

// superviseRun watches the exact run until it reaches a terminal state. It
// returns the state the run reached and whether the watcher can say nothing
// from its process group is left. A run that never claimed comes back as
// outcomeLostRace or outcomeNeverClaimed, which are deliberately distinct:
// conflating them turned a misconfigured executor into a relaunch loop.
func (w *watcher) superviseRun(ctx context.Context, command *exec.Cmd, taskID string, runID string, processGroupID int) (string, bool, error) {
	// Once the child is reaped its process ID is free for the operating system
	// to reuse, and it doubles as the group ID here. Whether anything was left
	// in the group is therefore read at the instant of reaping, before any
	// recycling is possible, and the channel close publishes it.
	finished := make(chan struct{})
	remnant := false
	go func() {
		_ = command.Wait()
		remnant = processGroupAlive(processGroupID)
		close(finished)
	}()

	// stillAlive answers whether the executor is running right now, which is
	// not the same as the loop's view from before the last request went out.
	stillAlive := func() bool {
		select {
		case <-finished:
			return false
		default:
			return true
		}
	}

	supervision := &runSupervision{}
	exited := false
	postExitAttempts := 0
	for {
		state, decided, err := w.inspectRun(ctx, supervision, taskID, runID, exited, stillAlive)
		retryWait, retryable := time.Duration(0), false
		if err != nil {
			retryWait, retryable = retryDelay(err, w.failure)
		}
		if err != nil && ctx.Err() != nil {
			// A reading that failed because the watcher is stopping is an
			// interrupt, not a monitoring failure, and must read as one.
			//
			// The guard deliberately does not cover a reading that succeeded.
			// That result is already known, and discarding it would report a
			// finished run as interrupted and tell the operator to re-run work
			// that is already in review. The interrupt is caught on the next
			// round instead. No test distinguishes the two, because the reads
			// carry this context: a cancellation before or during one makes the
			// read itself fail and land here correctly, leaving only the
			// microseconds after a response is parsed.
			return runStateInterrupted, w.stopExecutorGroup(processGroupID, exited, &remnant), nil
		}
		if err != nil && retryable {
			// The executor may have finished while the server was unreachable.
			select {
			case <-finished:
				exited = true
			default:
			}
			if exited {
				// The run is over, so its outcome is already decided on the
				// server and the watcher simply cannot read it. That is worth a
				// few more attempts, because an output posted just before the
				// exit would otherwise be recorded as an interruption. It is not
				// worth waiting for ever, which is what polling a dead run used
				// to do.
				postExitAttempts++
				if postExitAttempts > postExitReadAttempts {
					w.logf("Run %s ended and the server did not answer in %d attempts.", runID, postExitAttempts-1)
					return runStateInterrupted, w.stopExecutorGroup(processGroupID, true, &remnant), nil
				}
			}
			// Monitoring is polling too, so it has to wait out a struggling
			// server rather than keep asking. Without this a rate limit turns
			// into a tight loop that makes the rate limit worse.
			w.sleep(ctx, retryWait)
			continue
		}
		if err != nil {
			// The server has answered in a way that repeating cannot change,
			// so the executor must not be left running against it.
			w.logf("Monitoring run %s failed: %v", runID, err)
			// The executor may have been reaped while that request was
			// returning, in which case its ID is already reusable.
			select {
			case <-finished:
				exited = true
			default:
			}
			cleared := w.stopExecutorGroup(processGroupID, exited, &remnant)
			return runStateAmbiguous, cleared, err
		}
		if decided {
			if !exited {
				// A finished run is given the grace period to leave on its own
				// before the group is signalled.
				w.awaitExit(finished, exitGrace)
				select {
				case <-finished:
					exited = true
				default:
				}
			}
			return state, w.stopExecutorGroup(processGroupID, exited, &remnant), nil
		}
		if exited {
			// The executor is gone and the run shows nothing terminal yet, so
			// one more read has already happened above; treat it as interrupted.
			return runStateInterrupted, w.stopExecutorGroup(processGroupID, true, &remnant), nil
		}
		wait := pollInterval
		if !supervision.witnessed() {
			wait = firstObservationInterval
		}
		select {
		case <-finished:
			exited = true
		case <-ctx.Done():
			w.logf("Stopping. Ending the executor for run %s.", runID)
			// The executor may have been reaped in the same instant the
			// interrupt arrived, in which case its ID is already free for
			// reuse and must not be signalled on a guess.
			select {
			case <-finished:
				exited = true
			default:
			}
			return runStateInterrupted, w.stopExecutorGroup(processGroupID, exited, &remnant), nil
		case <-time.After(wait):
		}
	}
}

// runSupervision remembers what one run was ever seen to do. Ownership is not
// permanent, because a human transition clears it, so a single final reading
// cannot be trusted to say whether this run ever held the task.
type runSupervision struct {
	everOwned bool
	everWrote bool
	// observed records that at least one inspection read both the task and the
	// run's entries successfully while the executor was alive.
	observed bool
	// readFailed records that at least one inspection failed while the executor
	// was alive. The first inspection runs the instant supervision starts, so
	// observed alone is almost always true and proves very little; what matters
	// is whether there was a stretch the watcher could not see. A run whose
	// supervision hit any read error may have held the task unseen.
	readFailed bool
}

// witnessed reports whether this run was ever seen holding or writing to its
// task, which is the only positive evidence that its worktree may hold work.
func (s *runSupervision) witnessed() bool { return s.everOwned || s.everWrote }

// inspectRun reads the exact run state. It only decides once the evidence is
// unambiguous, so a slow executor is never mistaken for a finished one.
//
// A losing run has its worktree force deleted, so that conclusion demands
// positive evidence that this run never held the task. Anything ambiguous is
// treated as interrupted and keeps its worktree: a spare directory costs disk,
// while a wrong deletion destroys an agent's uncommitted work.
func (w *watcher) inspectRun(ctx context.Context, s *runSupervision, taskID string, runID string, executorExited bool, stillAlive func() bool) (string, bool, error) {
	// The reads carry the watcher's context so an interrupt reaches the
	// shutdown path at once rather than after the client timeout.
	reader := w.client.withContext(ctx)
	// Liveness is read after the responses land, not before the requests go
	// out. An executor that exits mid-request would otherwise have its
	// post-mortem answers recorded as though they were taken while it ran.
	aliveThrough := func() bool { return !executorExited && stillAlive() }

	taskReadStartedAlive := aliveThrough()
	task, err := reader.task(taskID)
	if err != nil {
		w.noteReadFailure(s, taskReadStartedAlive, "task "+taskID, err)
		return "", false, err
	}
	entriesReadStartedAlive := aliveThrough()
	entries, err := reader.entriesForRun(taskID, runID)
	if err != nil {
		w.noteReadFailure(s, entriesReadStartedAlive, "run "+runID, err)
		return "", false, err
	}
	// One inspection consists of both reads. Reset only after the pair succeeds
	// so one persistently failing endpoint still receives exponential backoff.
	w.failure.reset()
	owned := strings.EqualFold(task.ExecutionRunID, runID)
	outcome := classifyRunEntries(entries, runID)
	s.everOwned = s.everOwned || owned
	s.everWrote = s.everWrote || outcome.HasOutput || outcome.HasComment
	if aliveThrough() {
		// Only a sighting that both began and completed while the run was alive
		// can show it holding the task. A post-mortem read happens after
		// ownership may already have been erased, so it proves nothing about
		// what came before.
		s.observed = true
	}

	// A reviewer can complete the task within a poll interval of the output
	// landing, so both states count as a delivered result.
	if outcome.HasOutput && (task.Status == "needs_review" || task.Status == "done") {
		return runStateSuccess, true, nil
	}
	if outcome.HasComment && task.Status == "working" {
		return runStateBlocked, true, nil
	}
	if !executorExited {
		return "", false, nil
	}
	if s.witnessed() {
		// This run held the task at some point, so whatever is true now, its
		// worktree may hold real work.
		return runStateInterrupted, true, nil
	}
	if !s.observed || s.readFailed {
		// Either nothing was read while the run was alive, or there was a
		// stretch the watcher could not see. Ownership is erased by any later
		// transition, so an unseen stretch could have contained the whole life
		// of a claim. The watcher cannot say this run never held the task.
		return runStateAmbiguous, true, nil
	}
	if task.ExecutionRunID != "" {
		// Another run owns it, which is the ordinary losing race.
		return outcomeLostRace, true, nil
	}
	if task.Status == "queued" {
		// Nobody holds it and this run never did, so the executor exited
		// without ever claiming. A claim that happened and was then undone by a
		// person inside a single polling gap is indistinguishable from this,
		// which is why the gap before the first sighting is a quarter second
		// rather than the full interval.
		return outcomeNeverClaimed, true, nil
	}
	// Working under a legacy claim, or already moved on by a person. This run
	// was never seen to hold the task, but that cannot be proven, so the
	// worktree stays and the watcher keeps going.
	return runStateAmbiguous, true, nil
}

func (w *watcher) awaitExit(finished <-chan struct{}, grace time.Duration) {
	select {
	case <-finished:
	case <-time.After(grace):
	}
}

// These seams let a test observe what the watcher signals and simulate an
// operating system that has recycled a reaped process ID. Production always
// uses the real calls.
var (
	signalGroupForTest = signalProcessGroup
	groupAliveForTest  = processGroupAlive
)

// stopExecutorGroup ends the run's process group and reports whether nothing
// from it is left. It never signals a group ID the operating system may already
// have handed to somebody else: once the child has been reaped, the only
// trustworthy answer about the group is the one taken at the moment of reaping.
func (w *watcher) stopExecutorGroup(processGroupID int, reaped bool, remnant *bool) bool {
	if reaped && !*remnant {
		return true
	}
	return w.stopProcessGroup(processGroupID)
}

// stopProcessGroup ends the executor and everything it started, and does not
// return while the group is still alive. One watcher runs one process group, so
// the next candidate must not start until this one is gone.
//
// The tuned delays and jitter arrive with the resilience work; the escalation
// itself lives here because the guarantee it provides is part of this command.
func (w *watcher) stopProcessGroup(processGroupID int) bool {
	if processGroupID <= 0 {
		return true
	}
	if !groupAliveForTest(processGroupID) {
		return true
	}
	_ = signalGroupForTest(processGroupID, syscall.SIGTERM)
	if w.awaitProcessGroupExit(processGroupID, exitGrace) {
		return true
	}
	_ = signalGroupForTest(processGroupID, syscall.SIGKILL)
	if w.awaitProcessGroupExit(processGroupID, exitGrace) {
		return true
	}
	w.logf("Process group %d is still running after SIGKILL.", processGroupID)
	return false
}

// awaitProcessGroupExit reports whether the group ended within the deadline.
func (w *watcher) awaitProcessGroupExit(processGroupID int, within time.Duration) bool {
	deadline := w.now().Add(within)
	for {
		if !groupAliveForTest(processGroupID) {
			return true
		}
		if w.now().After(deadline) {
			return false
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func (w *watcher) reportOutcome(state string, candidate taskView, runID string, branch string, worktree string) {
	switch state {
	case runStateSuccess:
		w.logf("Task %s is in review. Run %s kept %s on %s.", candidate.ID, runID, worktree, branch)
	case runStateBlocked:
		w.logf("Task %s is blocked and stays in progress. Run %s kept %s on %s.", candidate.ID, runID, worktree, branch)
		w.logf("Read the agent's comment, then move the task back to Ready for a fresh run.")
	case runStateInterrupted:
		w.logf("Run %s ended without reporting. Task %s stays in progress and %s is kept on %s.", runID, candidate.ID, worktree, branch)
		w.logf("Inspect or commit anything useful, then move the task back to Ready for a fresh run.")
	case runStateAmbiguous:
		w.logf("Run %s ended and the watcher could not tell whether it ever held task %s.", runID, candidate.ID)
		w.logf("Nothing was deleted: %s is kept on %s in case it holds work.", worktree, branch)
	}
	w.logf("Release it later with 'slate runs clean %s'.", runID)
}

// newRunID produces the execution identity the server binds to one claim.
func newRunID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:16]), nil
}

func sleepContext(ctx context.Context, d time.Duration) {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}

// noteReadFailure records an unseen stretch and says what happened, using the
// same classifier that decides the wait, so the log and the behavior cannot
// disagree about whether a failure was transient.
func (w *watcher) noteReadFailure(s *runSupervision, alive bool, what string, err error) {
	if !retryableError(err) {
		// The caller reports this one, so saying it twice would only be noise.
		return
	}
	w.logf("Could not read %s: %v", what, err)
	if alive {
		// The run may have held the task through a stretch the watcher could
		// not see.
		s.readFailed = true
	}
}

// retryRead repeats a read until it succeeds or the server gives an answer that
// repeating cannot change. Only reads go through here: a mutation is never
// retried automatically, because the agent owns its own idempotency keys and
// the watcher must not decide on its behalf that a write is safe to repeat.
func (w *watcher) retryRead(ctx context.Context, describe string, attempt func() error) error {
	return retryReadWith(ctx, w.failure, w.sleep, w.logf, describe, attempt)
}

// retryReadWith is the same policy without a watcher, so the startup identity
// check can wait out an unreachable server before one exists.
func retryReadWith(ctx context.Context, failure *backoff, sleep func(context.Context, time.Duration), logf func(string, ...any), describe string, attempt func() error) error {
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		err := attempt()
		if err == nil {
			// Any answer at all means the server is reachable again.
			failure.reset()
			return nil
		}
		if ctx.Err() != nil {
			// Stopping is not a failure to wait out, and promising a retry
			// while shutting down would be a lie.
			return ctx.Err()
		}
		wait, retryable := retryDelay(err, failure)
		if !retryable {
			return fmt.Errorf("could not %s: %w", describe, err)
		}
		logf("Could not %s (%v). Trying again in %s.", describe, err, wait.Round(time.Second))
		sleep(ctx, wait)
	}
}

// retryableStatuses are the responses worth waiting out rather than giving up
// on. Everything else is a decision the server has already made.
var retryableStatuses = map[int]bool{
	// The approved design treats 500 and the gateway/service-unavailable
	// responses as transient server failures.
	http.StatusInternalServerError: true,
	http.StatusTooManyRequests:     true,
	http.StatusBadGateway:          true,
	http.StatusServiceUnavailable:  true,
	http.StatusGatewayTimeout:      true,
}

// recoverableAttemptError reports whether another candidate may follow. A local
// setup failure is worth retrying a few times; a terminal server answer or a
// process group that would not stop is not.
func recoverableAttemptError(err error) bool {
	if errors.Is(err, errGroupSurvived) || errors.Is(err, errRunRecordRemoval) || errors.Is(err, errUndiscoverableRun) {
		return false
	}
	// The same classifier that decides whether a read is worth repeating decides
	// whether the watcher may offer another candidate, so a malformed reply or a
	// bad address cannot be terminal for the read and recoverable for the loop.
	return retryableError(err)
}

// errGroupSurvived marks a run whose processes could not be ended.
var errGroupSurvived = errors.New("the executor process group did not stop")

// errRunRecordRemoval stops dispatch after a worktree was released but its
// bookkeeping could not be removed. Continuing could accumulate stale records
// until the retention guard blocks unrelated work.
var errRunRecordRemoval = errors.New("the released run record could not be removed")

// errUndiscoverableRun stops dispatch when local state could neither be cleaned
// nor recorded. Starting another run would create more untracked resources.
var errUndiscoverableRun = errors.New("the run could not be cleaned or recorded")
