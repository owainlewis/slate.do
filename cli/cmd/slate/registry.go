package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Run states a record can hold. Only retained states survive a watcher exit.
const (
	runStateLaunching   = "launching"
	runStateWorking     = "working"
	runStateSuccess     = "success"
	runStateBlocked     = "blocked"
	runStateInterrupted = "interrupted"
	// runStateAmbiguous is a run the watcher could not place. Its worktree is
	// kept, because only positive evidence justifies deleting one.
	runStateAmbiguous = "ambiguous"
)

// maxRetainedRuns bounds local disk. Each retained worktree is a full checkout.
const maxRetainedRuns = 10

// runRecord is local bookkeeping so an operator can find and clean the
// worktrees a watcher left behind. It is never used for server authorization
// and never holds a credential.
type runRecord struct {
	RunID            string `json:"runId"`
	Profile          string `json:"profile"`
	AgentID          string `json:"agentId"`
	TaskID           string `json:"taskId"`
	BoardID          string `json:"boardId,omitempty"`
	Branch           string `json:"branch"`
	Worktree         string `json:"worktree"`
	SourceRepository string `json:"sourceRepository"`
	SourceCommit     string `json:"sourceCommit"`
	State            string `json:"state"`
	ChildPID         int    `json:"childPid,omitempty"`
	ProcessGroupID   int    `json:"processGroupId,omitempty"`
	// WatcherPID is the process that owns this run. It is written before the
	// executor starts, so a cleanup command can tell a run that is being
	// launched right now from one a crashed watcher left behind.
	WatcherPID int       `json:"watcherPid,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// retained reports whether a record still owns a worktree on disk.
func (r runRecord) retained() bool {
	switch r.State {
	case runStateSuccess, runStateBlocked, runStateInterrupted, runStateAmbiguous:
		return true
	default:
		return false
	}
}

type registry struct {
	dir string
	now func() time.Time
	// beforeSave lets a test make one write fail at a chosen point in a run's
	// life. Production leaves it nil.
	beforeSave func(runRecord) error
}

// registryDir keeps run records under the user state directory, following
// XDG_STATE_HOME where it is set and falling back to the conventional path.
func registryDir() (string, error) {
	if override := strings.TrimSpace(os.Getenv("XDG_STATE_HOME")); override != "" {
		return filepath.Join(override, "slate", "runs"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("no home directory for the run registry: %w", err)
	}
	return filepath.Join(home, ".local", "state", "slate", "runs"), nil
}

func openRegistry() (*registry, error) {
	dir, err := registryDir()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &registry{dir: dir, now: time.Now}, nil
}

func (r *registry) path(runID string) string {
	return filepath.Join(r.dir, runID+".json")
}

// save writes atomically with owner-only permissions so a partial write can
// never be read back as a record.
func (r *registry) save(record runRecord) error {
	if r.beforeSave != nil {
		if err := r.beforeSave(record); err != nil {
			return err
		}
	}
	record.UpdatedAt = r.now().UTC()
	if record.CreatedAt.IsZero() {
		record.CreatedAt = record.UpdatedAt
	}
	raw, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	temporary, err := os.CreateTemp(r.dir, ".run-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(raw); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(name, r.path(record.RunID))
}

func (r *registry) load(runID string) (runRecord, error) {
	raw, err := os.ReadFile(r.path(runID))
	if err != nil {
		if os.IsNotExist(err) {
			return runRecord{}, fmt.Errorf("no run named %q", runID)
		}
		return runRecord{}, err
	}
	var record runRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		return runRecord{}, fmt.Errorf("run %s has an unreadable record: %w", runID, err)
	}
	return record, nil
}

func (r *registry) remove(runID string) error {
	err := os.Remove(r.path(runID))
	if err != nil && os.IsNotExist(err) {
		return nil
	}
	return err
}

// list returns every record, oldest first, optionally for one profile.
func (r *registry) list(profileName string) ([]runRecord, error) {
	entries, err := os.ReadDir(r.dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var records []runRecord
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		record, err := r.load(strings.TrimSuffix(entry.Name(), ".json"))
		if err != nil {
			// One unreadable record must not hide the rest.
			continue
		}
		if profileName != "" && record.Profile != profileName {
			continue
		}
		records = append(records, record)
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].CreatedAt.Equal(records[j].CreatedAt) {
			return records[i].RunID < records[j].RunID
		}
		return records[i].CreatedAt.Before(records[j].CreatedAt)
	})
	return records, nil
}

// retainedCount reports how many worktrees a profile is still holding. A
// watcher killed mid-run leaves a record in a working state whose worktree is
// still on disk, so the count follows the worktree rather than the state.
func (r *registry) retainedCount(profileName string) (int, error) {
	records, err := r.list(profileName)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, record := range records {
		if record.retained() || record.Worktree != "" {
			count++
		}
	}
	return count, nil
}
