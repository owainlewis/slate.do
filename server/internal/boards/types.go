package boards

import (
	"encoding/json"
	"time"
)

const (
	KindAction        = "action"
	StatusNew         = "new"
	StatusQueued      = "queued"
	StatusWorking     = "working"
	StatusNeedsReview = "needs_review"
	StatusDone        = "done"

	// Priority is optional and crosses lists. Most items stay unset.
	PriorityNone = ""
	PriorityP0   = "p0"
	PriorityP1   = "p1"
	PriorityP2   = "p2"
	PriorityP3   = "p3"

	ListColorSlate  = "slate"
	ListColorRed    = "red"
	ListColorOrange = "orange"
	ListColorYellow = "yellow"
	ListColorGreen  = "green"
	ListColorTeal   = "teal"
	ListColorBlue   = "blue"
	ListColorIndigo = "indigo"
	ListColorPurple = "purple"
	ListColorPink   = "pink"
)

type Bucket struct {
	ID                  string    `json:"id"`
	Name                string    `json:"name"`
	Goal                string    `json:"goal"`
	Color               string    `json:"color"`
	IsInbox             bool      `json:"isInbox"`
	LimitCount          int       `json:"limitCount"`
	SortOrder           int       `json:"sortOrder"`
	OpenCount           int       `json:"openCount"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
	Tasks               []Task    `json:"tasks,omitempty"`
	CompletedNextCursor string    `json:"completedNextCursor,omitempty"`
}

type Task struct {
	ID                string    `json:"id"`
	BucketID          string    `json:"bucketId"`
	Title             string    `json:"title"`
	Description       string    `json:"description,omitempty"`
	ScheduledDate     string    `json:"scheduledDate"`
	Kind              string    `json:"kind"`
	Status            string    `json:"status"`
	Priority          string    `json:"priority"`
	AssigneeAgentID   string    `json:"assigneeAgentId,omitempty"`
	AssigneeAgentName string    `json:"assigneeAgentName,omitempty"`
	ExecutionRunID    string    `json:"executionRunId,omitempty"`
	ParentTaskID      string    `json:"parentTaskId,omitempty"`
	ParentTaskTitle   string    `json:"parentTaskTitle,omitempty"`
	BucketName        string    `json:"listName,omitempty"`
	SortOrder         int       `json:"sortOrder"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

// MarshalJSON keeps the released done field available during the status
// rollout while ensuring status remains the sole completion model.
func (task Task) MarshalJSON() ([]byte, error) {
	type taskJSON Task
	return json.Marshal(struct {
		taskJSON
		Done bool `json:"done"`
	}{
		taskJSON: taskJSON(task),
		Done:     task.Status == StatusDone,
	})
}

type CreateBucketInput struct {
	Name       string `json:"name"`
	Goal       string `json:"goal"`
	Color      string `json:"color"`
	LimitCount int    `json:"limitCount"`
	IsInbox    bool   `json:"isInbox"`
}

type UpdateBucketInput struct {
	Name       *string `json:"name"`
	Goal       *string `json:"goal"`
	Color      *string `json:"color"`
	LimitCount *int    `json:"limitCount"`
	IsInbox    *bool   `json:"isInbox"`
	SortOrder  *int    `json:"sortOrder"`
}

type CreateTaskInput struct {
	Title           string `json:"title"`
	Description     string `json:"description"`
	ScheduledDate   string `json:"scheduledDate"`
	Kind            string `json:"kind"`
	Status          string `json:"status"`
	Priority        string `json:"priority"`
	OverrideLimit   bool   `json:"overrideLimit"`
	AssigneeAgentID string `json:"assigneeAgentId"`
	ParentTaskID    string `json:"parentTaskId"`
	IdempotencyKey  string `json:"-"`
}

type UpdateTaskInput struct {
	Title           *string `json:"title"`
	Description     *string `json:"description"`
	ScheduledDate   *string `json:"scheduledDate"`
	Kind            *string `json:"kind"`
	BucketID        *string `json:"bucketId"`
	Status          *string `json:"status"`
	Done            *bool   `json:"done"`
	Priority        *string `json:"priority"`
	AssigneeAgentID *string `json:"assigneeAgentId"`
	SortOrder       *int    `json:"sortOrder"`
	RunID           string  `json:"-"`
}

type MoveTaskInput struct {
	BucketID         string `json:"bucketId"`
	Position         *int   `json:"position"`
	ReferenceTaskID  string `json:"referenceTaskId"`
	Placement        string `json:"placement"`
	PreservePosition bool   `json:"preservePosition"`
	Append           bool   `json:"append"`
	Status           string `json:"status"`
}

type TaskFilter struct {
	BucketID        string
	Status          string
	Done            *bool
	Priority        string
	Sort            string
	Limit           int
	Cursor          string
	ActionsOnly     bool
	AssigneeAgentID string
	Unassigned      bool
	Query           string
	ScheduledFrom   string
	ScheduledTo     string
	ParentTaskID    string
	TopLevelOnly    bool
	InboxOnly       bool
	AgentQueue      bool
}

type TaskPage struct {
	Tasks      []Task `json:"tasks"`
	NextCursor string `json:"nextCursor,omitempty"`
}

// WorkspaceSummary describes account-wide work shown above the task board.
// Task counts use top-level action tasks, matching the board itself. The
// windowed counts use transition times so unrelated edits cannot refresh them.
type WorkspaceSummary struct {
	ActiveTasks int `json:"activeTasks"`
	InProgress  int `json:"inProgress"`
	InReview    int `json:"inReview"`
	Completed   int `json:"completed24h"`
	Runs        int `json:"runs24h"`
}

// InboxMessage is an agent-authored card entry read across the whole account.
// The inbox is one directional: agents post, people read. A person's own
// comments already live on the task, so echoing them back would be noise.
type InboxMessage struct {
	ID         string    `json:"id"`
	TaskID     string    `json:"taskId"`
	TaskTitle  string    `json:"taskTitle"`
	Kind       string    `json:"kind"`
	Body       string    `json:"body"`
	AuthorID   string    `json:"authorId"`
	AuthorName string    `json:"authorName"`
	RunID      string    `json:"runId,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

type TaskEntry struct {
	ID               string    `json:"id"`
	TaskID           string    `json:"taskId"`
	Kind             string    `json:"kind"`
	Body             string    `json:"body"`
	AuthorKind       string    `json:"authorKind"`
	AuthorID         string    `json:"authorId"`
	AuthorName       string    `json:"authorName"`
	RunID            string    `json:"runId,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	TaskStatus       string    `json:"taskStatus,omitempty"`
	TaskReviewReason string    `json:"taskReviewReason,omitempty"`
}

type CreateTaskEntryInput struct {
	Kind           string `json:"kind"`
	Body           string `json:"body"`
	IdempotencyKey string `json:"-"`
	RunID          string `json:"-"`
}

const MaxTaskEntries = 200
