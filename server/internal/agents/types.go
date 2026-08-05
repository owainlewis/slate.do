package agents

import (
	"time"

	"github.com/owainlewis/slate.do/server/internal/auth"
)

const (
	InitialOpenLimit      = 50
	InitialCompletedLimit = 20
	MaxPageSize           = 50
)

type WorkItem struct {
	ID              string    `json:"id"`
	BoardID         string    `json:"boardId"`
	BoardName       string    `json:"boardName"`
	BucketID        string    `json:"bucketId"`
	BucketName      string    `json:"bucketName"`
	Title           string    `json:"title"`
	Description     string    `json:"description,omitempty"`
	ScheduledDate   string    `json:"scheduledDate"`
	Kind            string    `json:"kind"`
	Done            bool      `json:"done"`
	Status          string    `json:"status"`
	AssigneeAgentID string    `json:"assigneeAgentId"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type WorkTotals struct {
	Ready     int `json:"ready"`
	Working   int `json:"working"`
	Review    int `json:"review"`
	Completed int `json:"completed"`
}

type AssignedWork struct {
	Ready             []WorkItem `json:"ready"`
	Working           []WorkItem `json:"working"`
	Review            []WorkItem `json:"review"`
	RecentlyCompleted []WorkItem `json:"recentlyCompleted"`
	Totals            WorkTotals `json:"totals"`
	OpenLimit         int        `json:"openLimit"`
	CompletedLimit    int        `json:"completedLimit"`
}

type Detail struct {
	Agent auth.AgentUser `json:"agent"`
	Work  AssignedWork   `json:"work"`
}

type WorkPage struct {
	Items       []WorkItem `json:"items"`
	Page        int        `json:"page"`
	PageSize    int        `json:"pageSize"`
	Total       int        `json:"total"`
	HasNext     bool       `json:"hasNext"`
	HasPrevious bool       `json:"hasPrevious"`
}

type ArchiveConflict struct {
	Ready   int `json:"ready"`
	Working int `json:"working"`
}
