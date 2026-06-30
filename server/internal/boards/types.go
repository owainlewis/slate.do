package boards

import "time"

const (
	StatusQueued      = "queued"
	StatusWorking     = "working"
	StatusNeedsReview = "needs_review"
	StatusDone        = "done"
)

type Board struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	BackgroundKind  string    `json:"backgroundKind"`
	BackgroundValue string    `json:"backgroundValue"`
	LayoutSize      int       `json:"layoutSize"`
	SortOrder       int       `json:"sortOrder"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
	Buckets         []Bucket  `json:"buckets,omitempty"`
}

type Bucket struct {
	ID         string    `json:"id"`
	BoardID    string    `json:"boardId"`
	Name       string    `json:"name"`
	IsInbox    bool      `json:"isInbox"`
	LimitCount int       `json:"limitCount"`
	SortOrder  int       `json:"sortOrder"`
	OpenCount  int       `json:"openCount"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
	Tasks      []Task    `json:"tasks,omitempty"`
}

type Task struct {
	ID         string    `json:"id"`
	BoardID    string    `json:"boardId"`
	BucketID   string    `json:"bucketId"`
	Title      string    `json:"title"`
	Done       bool      `json:"done"`
	Focus      bool      `json:"focus"`
	Assignee   string    `json:"assignee"`
	Status     string    `json:"status"`
	DueDate    string    `json:"dueDate,omitempty"`
	Notes      string    `json:"notes"`
	AgentBrief string    `json:"agentBrief"`
	SortOrder  int       `json:"sortOrder"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type CreateBoardInput struct {
	Name            string `json:"name"`
	BackgroundKind  string `json:"backgroundKind"`
	BackgroundValue string `json:"backgroundValue"`
	LayoutSize      int    `json:"layoutSize"`
}

type UpdateBoardInput struct {
	Name            *string `json:"name"`
	BackgroundKind  *string `json:"backgroundKind"`
	BackgroundValue *string `json:"backgroundValue"`
	LayoutSize      *int    `json:"layoutSize"`
	SortOrder       *int    `json:"sortOrder"`
}

type CreateBucketInput struct {
	Name       string `json:"name"`
	LimitCount int    `json:"limitCount"`
	IsInbox    bool   `json:"isInbox"`
}

type UpdateBucketInput struct {
	Name       *string `json:"name"`
	LimitCount *int    `json:"limitCount"`
	SortOrder  *int    `json:"sortOrder"`
}

type CreateTaskInput struct {
	Title         string `json:"title"`
	Focus         bool   `json:"focus"`
	Assignee      string `json:"assignee"`
	Status        string `json:"status"`
	DueDate       string `json:"dueDate"`
	Notes         string `json:"notes"`
	AgentBrief    string `json:"agentBrief"`
	OverrideLimit bool   `json:"overrideLimit"`
}

type UpdateTaskInput struct {
	Title      *string `json:"title"`
	BucketID   *string `json:"bucketId"`
	Done       *bool   `json:"done"`
	Focus      *bool   `json:"focus"`
	Assignee   *string `json:"assignee"`
	Status     *string `json:"status"`
	DueDate    *string `json:"dueDate"`
	Notes      *string `json:"notes"`
	AgentBrief *string `json:"agentBrief"`
	SortOrder  *int    `json:"sortOrder"`
}

type TaskFilter struct {
	BoardID  string
	Assignee string
	Status   string
	Done     *bool
	Limit    int
}
