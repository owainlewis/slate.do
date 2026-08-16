package main

import (
	"fmt"
	"net/url"
	"strings"
)

// identity is what /api/v1/me reports about the credential in use, plus what
// the server build supports.
type identity struct {
	Authenticated bool `json:"authenticated"`
	User          struct {
		ID           string `json:"id"`
		AgentID      string `json:"agentId"`
		AgentPurpose string `json:"agentPurpose"`
		DisplayName  string `json:"displayName"`
	} `json:"user"`
	Capabilities struct {
		ManagedRuns bool `json:"managedRuns"`
	} `json:"capabilities"`
}

type taskView struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	Status          string `json:"status"`
	Priority        string `json:"priority"`
	ListName        string `json:"listName"`
	AssigneeAgentID string `json:"assigneeAgentId"`
	ExecutionRunID  string `json:"executionRunId"`
}

type taskPage struct {
	Tasks []taskView `json:"tasks"`
}

type entryView struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	AuthorKind string `json:"authorKind"`
	AuthorID   string `json:"authorId"`
	RunID      string `json:"runId"`
}

type entryPage struct {
	Entries []entryView `json:"entries"`
}

func (c client) identity() (identity, error) {
	var result identity
	if err := c.do("GET", "/api/v1/me", nil, &result); err != nil {
		return identity{}, err
	}
	return result, nil
}

// agentTasks reads the server-ordered queue for one status, optionally scoped
// to a list. The server decides order, so the first entry is the right offer.
func (c client) agentTasks(status string, listID string, limit int) ([]taskView, error) {
	q := url.Values{}
	setQuery(q, "status", status)
	setQuery(q, "bucketId", listID)
	if limit > 0 {
		q.Set("limit", fmt.Sprint(limit))
	}
	var page taskPage
	if err := c.do("GET", "/api/v1/agent/tasks?"+q.Encode(), nil, &page); err != nil {
		return nil, err
	}
	return page.Tasks, nil
}

func (c client) task(taskID string) (taskView, error) {
	var result taskView
	if err := c.do("GET", "/api/v1/tasks/"+url.PathEscape(taskID), nil, &result); err != nil {
		return taskView{}, err
	}
	return result, nil
}

// entriesForRun returns only the entries one exact run wrote, which is how a
// watcher verifies its own result rather than any recent activity on the card.
func (c client) entriesForRun(taskID string, runID string) ([]entryView, error) {
	q := url.Values{}
	setQuery(q, "runId", runID)
	var page entryPage
	if err := c.do("GET", "/api/v1/tasks/"+url.PathEscape(taskID)+"/entries?"+q.Encode(), nil, &page); err != nil {
		return nil, err
	}
	return page.Entries, nil
}

// runOutcome classifies what one run's entries show.
type runOutcome struct {
	HasOutput  bool
	HasComment bool
}

func classifyRunEntries(entries []entryView, runID string) runOutcome {
	var outcome runOutcome
	for _, entry := range entries {
		if !strings.EqualFold(entry.RunID, runID) {
			continue
		}
		switch entry.Kind {
		case "output":
			outcome.HasOutput = true
		case "comment":
			outcome.HasComment = true
		}
	}
	return outcome
}
