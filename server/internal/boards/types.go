package boards

import "time"

const (
	KindAction        = "action"
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
	MaxTasksPerList int       `json:"maxTasksPerList"`
	SortOrder       int       `json:"sortOrder"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
	Buckets         []Bucket  `json:"buckets,omitempty"`
}

type Bucket struct {
	ID         string    `json:"id"`
	BoardID    string    `json:"boardId"`
	Name       string    `json:"name"`
	Goal       string    `json:"goal"`
	IsInbox    bool      `json:"isInbox"`
	LimitCount int       `json:"limitCount"`
	SortOrder  int       `json:"sortOrder"`
	OpenCount  int       `json:"openCount"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
	Tasks      []Task    `json:"tasks,omitempty"`
}

type Task struct {
	ID            string    `json:"id"`
	BoardID       string    `json:"boardId"`
	BucketID      string    `json:"bucketId"`
	Title         string    `json:"title"`
	Description   string    `json:"description"`
	ScheduledDate string    `json:"scheduledDate"`
	Kind          string    `json:"kind"`
	Done          bool      `json:"done"`
	Status        string    `json:"status"`
	SortOrder     int       `json:"sortOrder"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
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
	SortOrder  *int    `json:"sortOrder"`
}

type CreateTaskInput struct {
	Title         string `json:"title"`
	Description   string `json:"description"`
	ScheduledDate string `json:"scheduledDate"`
	Kind          string `json:"kind"`
	OverrideLimit bool   `json:"overrideLimit"`
}

type UpdateTaskInput struct {
	Title         *string `json:"title"`
	Description   *string `json:"description"`
	ScheduledDate *string `json:"scheduledDate"`
	Kind          *string `json:"kind"`
	BucketID      *string `json:"bucketId"`
	Done          *bool   `json:"done"`
	Status        *string `json:"status"`
	SortOrder     *int    `json:"sortOrder"`
}

type TaskFilter struct {
	BoardID     string
	Status      string
	Done        *bool
	Limit       int
	ActionsOnly bool
}
