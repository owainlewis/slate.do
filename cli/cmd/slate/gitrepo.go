package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// sourceCheckout is the repository a watcher branches from. It is never the
// working directory of an executor.
type sourceCheckout struct {
	Root   string
	Branch string
	Commit string
}

func runGit(ctx context.Context, dir string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, "git", args...)
	if dir != "" {
		command.Dir = dir
	}
	var out, errOut bytes.Buffer
	command.Stdout = &out
	command.Stderr = &errOut
	if err := command.Run(); err != nil {
		message := strings.TrimSpace(errOut.String())
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("git %s: %s", strings.Join(args, " "), message)
	}
	return strings.TrimSpace(out.String()), nil
}

// openSourceCheckout validates the repository a run will branch from. A
// detached HEAD or any uncommitted change stops startup, so a worktree can
// never silently omit local work.
func openSourceCheckout(ctx context.Context, workdir string) (sourceCheckout, error) {
	resolved, err := filepath.Abs(strings.TrimSpace(workdir))
	if err != nil {
		return sourceCheckout{}, err
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.IsDir() {
		return sourceCheckout{}, fmt.Errorf("%s is not a directory", resolved)
	}
	root, err := runGit(ctx, resolved, "rev-parse", "--show-toplevel")
	if err != nil {
		return sourceCheckout{}, fmt.Errorf("%s is not a Git repository", resolved)
	}
	branch, err := runGit(ctx, root, "symbolic-ref", "--quiet", "--short", "HEAD")
	if err != nil || branch == "" {
		return sourceCheckout{}, fmt.Errorf("%s is not on a named branch; check out a branch before watching", root)
	}
	status, err := runGit(ctx, root, "status", "--porcelain")
	if err != nil {
		return sourceCheckout{}, err
	}
	if status != "" {
		return sourceCheckout{}, fmt.Errorf("%s has uncommitted changes; commit or stash them so a run starts from a known commit", root)
	}
	commit, err := runGit(ctx, root, "rev-parse", "HEAD")
	if err != nil {
		return sourceCheckout{}, err
	}
	return sourceCheckout{Root: root, Branch: branch, Commit: commit}, nil
}

// worktreeBase is where disposable checkouts live, beneath the operating
// system's user cache directory.
func worktreeBase(profileName string) (string, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("no user cache directory for worktrees: %w", err)
	}
	return filepath.Join(cache, "slate", "worktrees", profileName), nil
}

// runBranchName derives a branch from validated identifiers, never from task
// text, so a title can never shape a path or a ref.
func runBranchName(taskID string, runID string) string {
	return "slate/" + taskID + "-" + shortRunID(runID)
}

func shortRunID(runID string) string {
	compact := strings.ReplaceAll(runID, "-", "")
	if len(compact) > 8 {
		return compact[:8]
	}
	return compact
}

// createRunWorktree gives one run its own branch and checkout at the verified
// source commit. It refuses to reuse a path, so two runs can never collide.
func createRunWorktree(ctx context.Context, source sourceCheckout, profileName string, taskID string, runID string) (path string, branch string, err error) {
	base, err := worktreeBase(profileName)
	if err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(base, 0o700); err != nil {
		return "", "", err
	}
	path = filepath.Join(base, runID)
	if _, err := os.Stat(path); err == nil {
		return "", "", fmt.Errorf("worktree %s already exists", path)
	} else if !os.IsNotExist(err) {
		return "", "", err
	}
	branch = runBranchName(taskID, runID)
	// The branch is checked first for the same reason as the path: cleanup
	// after a failure must never remove a ref this run did not create.
	if existing, err := runGit(ctx, source.Root, "branch", "--list", branch); err == nil && strings.TrimSpace(existing) != "" {
		return "", "", fmt.Errorf("branch %s already exists", branch)
	}
	if _, err := runGit(ctx, source.Root, "worktree", "add", "-b", branch, path, source.Commit); err != nil {
		// The branch is created before the checkout, so a checkout failure
		// leaves it behind. Nothing has run in this worktree yet, so removing
		// both is safe and stops repeated launches leaving orphan refs.
		// Cleanup runs even when the caller's context is already cancelled,
		// otherwise an interrupt landing during the checkout leaves the branch
		// behind with nothing recorded to find it by. This is reasoned rather
		// than tested: reproducing it needs a cancellation inside the git
		// command, since a context cancelled any earlier stops the branch from
		// being created at all.
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		if discardErr := discardRunWorktree(cleanupCtx, source.Root, path, branch); discardErr != nil {
			return "", "", fmt.Errorf("%w (cleaning up also failed: %v)", err, discardErr)
		}
		return "", "", err
	}
	return path, branch, nil
}

// discardRunWorktree removes a losing run's disposable checkout and branch even
// when the executor changed them. It is only ever called for a run that failed
// to claim, so nothing a human wants to keep is at risk.
func discardRunWorktree(ctx context.Context, repositoryRoot string, path string, branch string) error {
	var problems []string
	if path != "" {
		if _, err := runGit(ctx, repositoryRoot, "worktree", "remove", "--force", path); err != nil {
			// A partially created worktree may not be registered yet.
			if removeErr := os.RemoveAll(path); removeErr != nil {
				problems = append(problems, err.Error())
			}
			_, _ = runGit(ctx, repositoryRoot, "worktree", "prune")
		}
	}
	if branch != "" {
		if _, err := runGit(ctx, repositoryRoot, "branch", "-D", branch); err != nil {
			// A run that never reached branch creation has nothing to delete.
			if !strings.Contains(err.Error(), "not found") {
				problems = append(problems, err.Error())
			}
		}
	}
	if len(problems) > 0 {
		return errors.New(strings.Join(problems, "; "))
	}
	return nil
}

// releaseRetainedWorktree removes a worktree an operator has finished with. It
// never forces, so uncommitted work is reported rather than destroyed, and it
// keeps the branch so any commits remain reachable.
func releaseRetainedWorktree(ctx context.Context, repositoryRoot string, path string) error {
	status, err := runGit(ctx, path, "status", "--porcelain")
	if err != nil {
		return err
	}
	if status != "" {
		return fmt.Errorf("worktree %s has uncommitted changes; commit or discard them first", path)
	}
	if _, err := runGit(ctx, repositoryRoot, "worktree", "remove", path); err != nil {
		return err
	}
	return nil
}
