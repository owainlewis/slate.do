package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
)

func runsCmd(args []string) error {
	if wantsHelp(args) {
		return printHelp("runs")
	}
	switch args[0] {
	case "list":
		fs := newFlagSet("runs list")
		profileName := fs.String("profile", "", "limit to one profile")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if fs.NArg() != 0 {
			return errors.New("usage: slate runs list [--profile <name>]")
		}
		return listRuns(strings.TrimSpace(*profileName))
	case "clean":
		id, err := singleID("slate runs clean <run-id>", args[1:])
		if err != nil {
			return err
		}
		return cleanRun(context.Background(), strings.TrimSpace(id))
	default:
		return fmt.Errorf("unknown runs command %q; run 'slate help runs'", args[0])
	}
}

func listRuns(profileName string) error {
	runs, err := openRegistry()
	if err != nil {
		return err
	}
	records, err := runs.list(profileName)
	if err != nil {
		return err
	}
	if records == nil {
		records = []runRecord{}
	}
	return printJSON(map[string]any{"runs": records})
}

// cleanRun releases one retained worktree. It refuses while anything from the
// run is still alive and never forces, so uncommitted work is reported rather
// than destroyed. The branch stays so any commits remain reachable.
func cleanRun(ctx context.Context, runID string) error {
	if !validUUID(runID) {
		return fmt.Errorf("run ID %q is not a valid run ID", runID)
	}
	runs, err := openRegistry()
	if err != nil {
		return err
	}
	record, err := runs.load(runID)
	if err != nil {
		return err
	}
	if record.ProcessGroupID > 0 && processGroupAlive(record.ProcessGroupID) {
		return fmt.Errorf("run %s still has a running process; stop it before cleaning", runID)
	}
	// A run being launched right now has a worktree but no process group
	// recorded yet. Its watcher is alive, so removing the checkout would pull it
	// out from under an executor that has already started in it.
	if !record.retained() && record.WatcherPID > 0 && processAlive(record.WatcherPID) {
		return fmt.Errorf("run %s belongs to a watcher that is still running; stop it before cleaning", runID)
	}
	// A watcher killed mid-run leaves its record in a working state. Nothing
	// from it is alive, so the worktree it left behind must still be
	// releasable, or it could only ever be removed by hand.
	if !record.retained() && record.Worktree == "" {
		return fmt.Errorf("run %s is in state %q and holds no worktree", runID, record.State)
	}
	// Only a worktree that is already gone may be skipped. Any other stat
	// failure would orphan the directory: the record would disappear, so it
	// would stop showing in runs list and stop counting toward retention.
	if _, statErr := os.Stat(record.Worktree); statErr == nil {
		if err := releaseRetainedWorktree(ctx, record.SourceRepository, record.Worktree); err != nil {
			return err
		}
	} else if !os.IsNotExist(statErr) {
		return statErr
	}
	if err := runs.remove(runID); err != nil {
		return err
	}
	return printJSON(map[string]any{
		"runId":    runID,
		"worktree": record.Worktree,
		"branch":   record.Branch,
		"removed":  true,
		"note":     "The branch was kept so any commits remain reachable.",
	})
}
