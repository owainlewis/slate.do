package boards

import "time"

const (
	KindAction        = "action"
	StatusQueued      = "queued"
	StatusWorking     = "working"
	StatusNeedsReview = "needs_review"
	StatusDone        = "done"

	// Priority is optional and crosses lists. Most items stay unset.
	PriorityNone = ""
	PriorityP0   = "p0"
	PriorityP1   = "p1"
	PriorityP2   = "p2"
)

type Board struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	BackgroundKind  string    `json:"backgroundKind"`
	BackgroundValue string    `json:"backgroundValue"`
	MaxTasksPerList int       `json:"maxTasksPerList"`
	SortOrder       int       `json:"sortOrder"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
	Buckets         []Bucket  `json:"buckets,omitempty"`
}

type Bucket struct {
	ID                  string    `json:"id"`
	BoardID             string    `json:"boardId"`
	Name                string    `json:"name"`
	Goal                string    `json:"goal"`
	IsInbox             bool      `json:"isInbox"`
	LimitCount          int       `json:"limitCount"`
	SortOrder           int       `json:"sortOrder"`
	OpenCount           int       `json:"openCount"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
	Tasks               []Task    `json:"tasks,omitempty"`
	CompletedNextCursor string    `json:"completedNextCursor,omitempty"`
	BoardName           string    `json:"boardName,omitempty"`
}

type Task struct {
	ID                string    `json:"id"`
	BoardID           string    `json:"boardId"`
	BucketID          string    `json:"bucketId"`
	Title             string    `json:"title"`
	Description       string    `json:"description,omitempty"`
	ScheduledDate     string    `json:"scheduledDate"`
	Kind              string    `json:"kind"`
	Done              bool      `json:"done"`
	Status            string    `json:"status"`
	Priority          string    `json:"priority"`
	AssigneeAgentID   string    `json:"assigneeAgentId,omitempty"`
	AssigneeAgentName string    `json:"assigneeAgentName,omitempty"`
	ParentTaskID      string    `json:"parentTaskId,omitempty"`
	ParentTaskTitle   string    `json:"parentTaskTitle,omitempty"`
	BucketName        string    `json:"listName,omitempty"`
	BoardName         string    `json:"boardName,omitempty"`
	SortOrder         int       `json:"sortOrder"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type CreateBoardInput struct {
	Name            string `json:"name"`
	BackgroundKind  string `json:"backgroundKind"`
	BackgroundValue string `json:"backgroundValue"`
	MaxTasksPerList int    `json:"maxTasksPerList"`
}

type UpdateBoardInput struct {
	Name            *string `json:"name"`
	BackgroundKind  *string `json:"backgroundKind"`
	BackgroundValue *string `json:"backgroundValue"`
	MaxTasksPerList *int    `json:"maxTasksPerList"`
	SortOrder       *int    `json:"sortOrder"`
}

type CreateBucketInput struct {
	Name       string `json:"name"`
	Goal       string `json:"goal"`
	LimitCount int    `json:"limitCount"`
	IsInbox    bool   `json:"isInbox"`
}

type UpdateBucketInput struct {
	Name       *string `json:"name"`
	Goal       *string `json:"goal"`
	LimitCount *int    `json:"limitCount"`
	IsInbox    *bool   `json:"isInbox"`
	SortOrder  *int    `json:"sortOrder"`
}

type CreateTaskInput struct {
	Title           string `json:"title"`
	Description     string `json:"description"`
	ScheduledDate   string `json:"scheduledDate"`
	Kind            string `json:"kind"`
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
	Done            *bool   `json:"done"`
	Status          *string `json:"status"`
	Priority        *string `json:"priority"`
	AssigneeAgentID *string `json:"assigneeAgentId"`
	SortOrder       *int    `json:"sortOrder"`
}

type MoveTaskInput struct {
	BucketID string `json:"bucketId"`
	Position *int   `json:"position"`
}

type TaskFilter struct {
	BoardID         string
	BucketID        string
	Status          string
	Priority        string
	Done            *bool
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
}

type TaskPage struct {
	Tasks      []Task `json:"tasks"`
	NextCursor string `json:"nextCursor,omitempty"`
}

type CardEntry struct {
	ID            string    `json:"id"`
	TaskID        string    `json:"cardId"`
	Kind          string    `json:"kind"`
	Body          string    `json:"body"`
	NeedsResponse bool      `json:"needsResponse"`
	AuthorKind    string    `json:"authorKind"`
	AuthorID      string    `json:"authorId"`
	AuthorName    string    `json:"authorName"`
	CreatedAt     time.Time `json:"createdAt"`
}

type CreateCardEntryInput struct {
	Kind          string `json:"kind"`
	Body          string `json:"body"`
	NeedsResponse bool   `json:"needsResponse"`
}

const MaxCardEntries = 200
