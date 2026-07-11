package boards

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/owainlewis/slate.do/server/internal/database"
)

var (
	ErrNotFound        = errors.New("not found")
	ErrLimitFull       = errors.New("list limit reached")
	ErrInvalidData     = errors.New("invalid data")
	ErrTaskUnavailable = errors.New("task is not available")
)

const defaultMaxTasksPerList = 20

type Store struct {
	db *database.Pool
}

func NewStore(db *database.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) SeedDefaultBoard(ctx context.Context, userID string) error {
	var count int
	if err := s.db.QueryRow(ctx, "SELECT count(*) FROM boards WHERE user_id = $1", userID).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	board, err := s.CreateBoard(ctx, userID, CreateBoardInput{Name: "Today"})
	if err != nil {
		return err
	}
	defaults := []CreateBucketInput{
		{Name: "Inbox", LimitCount: defaultMaxTasksPerList, IsInbox: true},
		{Name: "Focus", LimitCount: defaultMaxTasksPerList},
		{Name: "Waiting", LimitCount: defaultMaxTasksPerList},
		{Name: "Later", LimitCount: defaultMaxTasksPerList},
		{Name: "Done", LimitCount: defaultMaxTasksPerList},
	}
	for _, bucket := range defaults {
		if _, err := s.CreateBucket(ctx, userID, board.ID, bucket); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ListBoards(ctx context.Context, userID string) ([]Board, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, name, background_kind, background_value, max_tasks_per_list, sort_order, created_at, updated_at
		FROM boards
		WHERE user_id = $1
		ORDER BY sort_order, created_at
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var boards []Board
	for rows.Next() {
		board, err := scanBoard(rows)
		if err != nil {
			return nil, err
		}
		boards = append(boards, board)
	}
	return boards, rows.Err()
}

func (s *Store) GetBoard(ctx context.Context, userID string, id string) (Board, error) {
	row := s.db.QueryRow(ctx, `
		SELECT id::text, name, background_kind, background_value, max_tasks_per_list, sort_order, created_at, updated_at
		FROM boards
		WHERE user_id = $1 AND id = $2
	`, userID, id)
	board, err := scanBoard(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Board{}, ErrNotFound
	}
	if err != nil {
		return Board{}, err
	}
	buckets, err := s.listBuckets(ctx, userID, id)
	if err != nil {
		return Board{}, err
	}
	for i := range buckets {
		tasks, err := s.listBucketTasks(ctx, userID, buckets[i].ID)
		if err != nil {
			return Board{}, err
		}
		buckets[i].Tasks = tasks
	}
	board.Buckets = buckets
	return board, nil
}

func (s *Store) CreateBoard(ctx context.Context, userID string, input CreateBoardInput) (Board, error) {
	name := clean(input.Name)
	if name == "" {
		return Board{}, fmt.Errorf("%w: board name is required", ErrInvalidData)
	}
	maxTasksPerList := input.MaxTasksPerList
	if maxTasksPerList == 0 {
		maxTasksPerList = defaultMaxTasksPerList
	}
	if maxTasksPerList < 1 {
		return Board{}, fmt.Errorf("%w: list limit must be positive", ErrInvalidData)
	}
	backgroundKind := clean(input.BackgroundKind)
	if backgroundKind == "" {
		backgroundKind = "plain"
	}
	var board Board
	err := s.db.QueryRow(ctx, `
		INSERT INTO boards (user_id, name, background_kind, background_value, max_tasks_per_list, sort_order)
		VALUES (
			$1, $2, $3, $4, $5,
			COALESCE((SELECT max(sort_order) + 1 FROM boards WHERE user_id = $1), 0)
		)
		RETURNING id::text, name, background_kind, background_value, max_tasks_per_list, sort_order, created_at, updated_at
	`, userID, name, backgroundKind, input.BackgroundValue, maxTasksPerList).Scan(
		&board.ID, &board.Name, &board.BackgroundKind, &board.BackgroundValue,
		&board.MaxTasksPerList, &board.SortOrder, &board.CreatedAt, &board.UpdatedAt,
	)
	return board, err
}

func (s *Store) UpdateBoard(ctx context.Context, userID string, id string, input UpdateBoardInput) (Board, error) {
	current, err := s.GetBoard(ctx, userID, id)
	if err != nil {
		return Board{}, err
	}
	if input.Name != nil {
		current.Name = clean(*input.Name)
	}
	if input.BackgroundKind != nil {
		current.BackgroundKind = clean(*input.BackgroundKind)
		if current.BackgroundKind == "" {
			current.BackgroundKind = "plain"
		}
	}
	if input.BackgroundValue != nil {
		current.BackgroundValue = *input.BackgroundValue
	}
	if input.MaxTasksPerList != nil {
		if *input.MaxTasksPerList < 1 {
			return Board{}, fmt.Errorf("%w: list limit must be positive", ErrInvalidData)
		}
		current.MaxTasksPerList = *input.MaxTasksPerList
	}
	if input.SortOrder != nil {
		current.SortOrder = *input.SortOrder
	}
	if current.Name == "" {
		return Board{}, fmt.Errorf("%w: board name is required", ErrInvalidData)
	}
	var board Board
	err = s.db.QueryRow(ctx, `
		UPDATE boards
		SET name = $3, background_kind = $4, background_value = $5, max_tasks_per_list = $6, sort_order = $7, updated_at = now()
		WHERE user_id = $1 AND id = $2
		RETURNING id::text, name, background_kind, background_value, max_tasks_per_list, sort_order, created_at, updated_at
	`, userID, id, current.Name, current.BackgroundKind, current.BackgroundValue, current.MaxTasksPerList, current.SortOrder).Scan(
		&board.ID, &board.Name, &board.BackgroundKind, &board.BackgroundValue,
		&board.MaxTasksPerList, &board.SortOrder, &board.CreatedAt, &board.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Board{}, ErrNotFound
	}
	return board, err
}

func (s *Store) DeleteBoard(ctx context.Context, userID string, id string) error {
	tag, err := s.db.Exec(ctx, "DELETE FROM boards WHERE user_id = $1 AND id = $2", userID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) CreateBucket(ctx context.Context, userID string, boardID string, input CreateBucketInput) (Bucket, error) {
	if _, err := s.GetBoard(ctx, userID, boardID); err != nil {
		return Bucket{}, err
	}
	name := clean(input.Name)
	if name == "" {
		return Bucket{}, fmt.Errorf("%w: bucket name is required", ErrInvalidData)
	}
	limit := input.LimitCount
	if limit == 0 {
		limit = 5
	}
	if limit < 1 {
		return Bucket{}, fmt.Errorf("%w: bucket limit must be positive", ErrInvalidData)
	}
	var bucket Bucket
	err := s.db.QueryRow(ctx, `
		INSERT INTO buckets (board_id, name, goal, is_inbox, limit_count, sort_order)
		VALUES (
			$1, $2, $3, $4, $5,
			COALESCE((SELECT max(sort_order) + 1 FROM buckets WHERE board_id = $1), 0)
		)
		RETURNING id::text, board_id::text, name, goal, is_inbox, limit_count, sort_order, created_at, updated_at
	`, boardID, name, input.Goal, input.IsInbox, limit).Scan(
		&bucket.ID, &bucket.BoardID, &bucket.Name, &bucket.Goal, &bucket.IsInbox, &bucket.LimitCount,
		&bucket.SortOrder, &bucket.CreatedAt, &bucket.UpdatedAt,
	)
	return bucket, err
}

func (s *Store) UpdateBucket(ctx context.Context, userID string, id string, input UpdateBucketInput) (Bucket, error) {
	current, err := s.getBucket(ctx, userID, id)
	if err != nil {
		return Bucket{}, err
	}
	if input.Name != nil {
		current.Name = clean(*input.Name)
	}
	if input.Goal != nil {
		current.Goal = clean(*input.Goal)
	}
	if input.LimitCount != nil {
		current.LimitCount = *input.LimitCount
	}
	if input.SortOrder != nil {
		current.SortOrder = *input.SortOrder
	}
	if current.Name == "" {
		return Bucket{}, fmt.Errorf("%w: bucket name is required", ErrInvalidData)
	}
	if current.LimitCount < 1 {
		return Bucket{}, fmt.Errorf("%w: bucket limit must be positive", ErrInvalidData)
	}
	var bucket Bucket
	err = s.db.QueryRow(ctx, `
		UPDATE buckets b
		SET name = $3, goal = $4, limit_count = $5, sort_order = $6, updated_at = now()
		FROM boards bo
		WHERE bo.id = b.board_id AND bo.user_id = $1 AND b.id = $2
		RETURNING b.id::text, b.board_id::text, b.name, b.goal, b.is_inbox, b.limit_count, b.sort_order, b.created_at, b.updated_at
	`, userID, id, current.Name, current.Goal, current.LimitCount, current.SortOrder).Scan(
		&bucket.ID, &bucket.BoardID, &bucket.Name, &bucket.Goal, &bucket.IsInbox, &bucket.LimitCount,
		&bucket.SortOrder, &bucket.CreatedAt, &bucket.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Bucket{}, ErrNotFound
	}
	return bucket, err
}

func (s *Store) DeleteBucket(ctx context.Context, userID string, id string) error {
	tag, err := s.db.Exec(ctx, `
		DELETE FROM buckets b
		USING boards bo
		WHERE bo.id = b.board_id AND bo.user_id = $1 AND b.id = $2
	`, userID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ReorderBuckets(ctx context.Context, userID string, boardID string, ids []string) error {
	if _, err := s.GetBoard(ctx, userID, boardID); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for i, id := range ids {
		tag, err := tx.Exec(ctx, "UPDATE buckets SET sort_order = $1, updated_at = now() WHERE board_id = $2 AND id = $3", i, boardID, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) CreateTask(ctx context.Context, userID string, bucketID string, input CreateTaskInput) (Task, error) {
	bucket, err := s.getBucket(ctx, userID, bucketID)
	if err != nil {
		return Task{}, err
	}
	title := clean(input.Title)
	if title == "" {
		return Task{}, fmt.Errorf("%w: task title is required", ErrInvalidData)
	}
	scheduledDate, err := validDate(input.ScheduledDate)
	if err != nil {
		return Task{}, err
	}
	kind := clean(input.Kind)
	if kind == "" {
		kind = KindItem
	}
	if !validKind(kind) {
		return Task{}, fmt.Errorf("%w: invalid item kind", ErrInvalidData)
	}
	parentID, err := s.validParent(ctx, userID, bucketID, input.ParentID, "")
	if err != nil {
		return Task{}, err
	}
	if kind == KindAction && !input.OverrideLimit {
		full, err := s.bucketFull(ctx, bucketID)
		if err != nil {
			return Task{}, err
		}
		if full {
			return Task{}, ErrLimitFull
		}
	}
	row := s.db.QueryRow(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, description, scheduled_date, kind, parent_task_id, status, sort_order)
		VALUES (
			$1, $2, $3, $4, NULLIF($5, '')::date, $6, NULLIF($7, '')::uuid, $8,
			COALESCE((SELECT max(sort_order) + 1 FROM tasks WHERE bucket_id = $2), 0)
		)
		RETURNING id::text, board_id::text, bucket_id::text, title, description,
			COALESCE(scheduled_date::text, ''), kind, COALESCE(parent_task_id::text, ''), done, status, sort_order, created_at, updated_at
	`, bucket.BoardID, bucketID, title, input.Description, scheduledDate, kind, parentID, StatusQueued)
	return scanTask(row)
}

func (s *Store) UpdateTask(ctx context.Context, userID string, id string, input UpdateTaskInput) (Task, error) {
	current, err := s.GetTask(ctx, userID, id)
	if err != nil {
		return Task{}, err
	}
	originalKind := current.Kind
	originalBucketID := current.BucketID
	originalDone := current.Done
	if input.Title != nil {
		current.Title = clean(*input.Title)
	}
	if input.Description != nil {
		current.Description = *input.Description
	}
	if input.ScheduledDate != nil {
		current.ScheduledDate, err = validDate(*input.ScheduledDate)
		if err != nil {
			return Task{}, err
		}
	}
	if input.Kind != nil {
		kind := clean(*input.Kind)
		if !validKind(kind) {
			return Task{}, fmt.Errorf("%w: invalid item kind", ErrInvalidData)
		}
		current.Kind = kind
		if kind == KindItem {
			current.Done = false
			current.Status = StatusQueued
		}
	}
	if input.BucketID != nil && *input.BucketID != current.BucketID {
		bucket, err := s.getBucket(ctx, userID, *input.BucketID)
		if err != nil {
			return Task{}, err
		}
		current.BucketID = bucket.ID
		current.BoardID = bucket.BoardID
		current.SortOrder = 0
	}
	if input.ParentID != nil {
		current.ParentID = clean(*input.ParentID)
	}
	if current.BucketID != originalBucketID {
		hasChildren, err := s.taskHasChildren(ctx, userID, current.ID)
		if err != nil {
			return Task{}, err
		}
		if hasChildren {
			return Task{}, fmt.Errorf("%w: move sub-items before moving their parent", ErrInvalidData)
		}
	}
	if input.Status != nil {
		status := clean(*input.Status)
		if !validStatus(status) {
			return Task{}, fmt.Errorf("%w: invalid status", ErrInvalidData)
		}
		if status == StatusWorking {
			return Task{}, fmt.Errorf("%w: working status requires claim", ErrInvalidData)
		}
		if current.Kind != KindAction {
			return Task{}, fmt.Errorf("%w: only actions have workflow status", ErrInvalidData)
		}
		current.Status = status
		current.Done = status == StatusDone
	}
	if input.Done != nil {
		if current.Kind != KindAction && *input.Done {
			return Task{}, fmt.Errorf("%w: only actions can be completed", ErrInvalidData)
		}
		current.Done = *input.Done
		if current.Done {
			current.Status = StatusDone
		} else if current.Status == StatusDone {
			current.Status = StatusQueued
		}
	}
	if input.SortOrder != nil {
		current.SortOrder = *input.SortOrder
	}
	if current.Title == "" {
		return Task{}, fmt.Errorf("%w: task title is required", ErrInvalidData)
	}
	parentID, err := s.validParent(ctx, userID, current.BucketID, current.ParentID, current.ID)
	if err != nil {
		return Task{}, err
	}
	current.ParentID = parentID
	if current.Kind == KindAction && !current.Done && (originalKind != KindAction || originalBucketID != current.BucketID || originalDone) {
		full, err := s.bucketFullExcept(ctx, current.BucketID, current.ID)
		if err != nil {
			return Task{}, err
		}
		if full {
			return Task{}, ErrLimitFull
		}
	}
	row := s.db.QueryRow(ctx, `
		UPDATE tasks t
		SET board_id = $3, bucket_id = $4, title = $5, description = $6,
			scheduled_date = NULLIF($7, '')::date, kind = $8,
			parent_task_id = NULLIF($9, '')::uuid, done = $10,
			status = $11, sort_order = $12, updated_at = now()
		FROM boards b
		WHERE b.id = t.board_id AND b.user_id = $1 AND t.id = $2
		RETURNING t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind, COALESCE(t.parent_task_id::text, ''), t.done,
			t.status, t.sort_order, t.created_at, t.updated_at
	`, userID, id, current.BoardID, current.BucketID, current.Title, current.Description, current.ScheduledDate, current.Kind, current.ParentID, current.Done,
		current.Status, current.SortOrder)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	return task, err
}

func (s *Store) ClaimTask(ctx context.Context, userID string, id string) (Task, error) {
	row := s.db.QueryRow(ctx, `
		UPDATE tasks t
		SET status = $3, updated_at = now()
		FROM boards b
		WHERE b.id = t.board_id
			AND b.user_id = $1
			AND t.id = $2
			AND t.done = false
			AND t.kind = $5
			AND t.status = $4
		RETURNING t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind, COALESCE(t.parent_task_id::text, ''), t.done,
			t.status, t.sort_order, t.created_at, t.updated_at
	`, userID, id, StatusWorking, StatusQueued, KindAction)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrTaskUnavailable
	}
	return task, err
}

func (s *Store) DeleteTask(ctx context.Context, userID string, id string) error {
	tag, err := s.db.Exec(ctx, `
		DELETE FROM tasks t
		USING boards b
		WHERE b.id = t.board_id AND b.user_id = $1 AND t.id = $2
	`, userID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ReorderTasks(ctx context.Context, userID string, bucketID string, ids []string) error {
	if _, err := s.getBucket(ctx, userID, bucketID); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for i, id := range ids {
		tag, err := tx.Exec(ctx, `
			UPDATE tasks t
			SET sort_order = $1, updated_at = now()
			FROM boards b
			WHERE b.id = t.board_id AND b.user_id = $2 AND t.bucket_id = $3 AND t.id = $4
		`, i, userID, bucketID, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) GetTask(ctx context.Context, userID string, id string) (Task, error) {
	row := s.db.QueryRow(ctx, `
		SELECT t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind, COALESCE(t.parent_task_id::text, ''), t.done,
			t.status, t.sort_order, t.created_at, t.updated_at
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		WHERE b.user_id = $1 AND t.id = $2
	`, userID, id)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	return task, err
}

func (s *Store) ListTasks(ctx context.Context, userID string, filter TaskFilter) ([]Task, error) {
	doneSQL := ""
	args := []any{userID}
	if filter.BoardID != "" {
		args = append(args, filter.BoardID)
		doneSQL += fmt.Sprintf(" AND t.board_id = $%d", len(args))
	}
	if filter.Status != "" {
		args = append(args, filter.Status)
		doneSQL += fmt.Sprintf(" AND t.status = $%d", len(args))
	}
	if filter.Done != nil {
		args = append(args, *filter.Done)
		doneSQL += fmt.Sprintf(" AND t.done = $%d", len(args))
	}
	if filter.ActionsOnly {
		args = append(args, KindAction)
		doneSQL += fmt.Sprintf(" AND t.kind = $%d", len(args))
	}
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	args = append(args, limit)
	query := `
		SELECT t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind, COALESCE(t.parent_task_id::text, ''), t.done,
			t.status, t.sort_order, t.created_at, t.updated_at
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		WHERE b.user_id = $1` + doneSQL + `
		ORDER BY t.created_at DESC
		LIMIT $` + fmt.Sprint(len(args))
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (s *Store) listBuckets(ctx context.Context, userID string, boardID string) ([]Bucket, error) {
	rows, err := s.db.Query(ctx, `
		SELECT b.id::text, b.board_id::text, b.name, b.goal, b.is_inbox, bo.max_tasks_per_list, b.sort_order,
			COUNT(t.id) FILTER (WHERE t.kind = 'action' AND t.done = false)::int AS open_count,
			b.created_at, b.updated_at
		FROM buckets b
		JOIN boards bo ON bo.id = b.board_id
		LEFT JOIN tasks t ON t.bucket_id = b.id
		WHERE bo.user_id = $1 AND b.board_id = $2
		GROUP BY b.id, bo.max_tasks_per_list
		ORDER BY b.sort_order, b.created_at
	`, userID, boardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var buckets []Bucket
	for rows.Next() {
		bucket, err := scanBucket(rows)
		if err != nil {
			return nil, err
		}
		buckets = append(buckets, bucket)
	}
	return buckets, rows.Err()
}

func (s *Store) getBucket(ctx context.Context, userID string, id string) (Bucket, error) {
	row := s.db.QueryRow(ctx, `
		SELECT b.id::text, b.board_id::text, b.name, b.goal, b.is_inbox, bo.max_tasks_per_list, b.sort_order,
			COUNT(t.id) FILTER (WHERE t.kind = 'action' AND t.done = false)::int AS open_count,
			b.created_at, b.updated_at
		FROM buckets b
		JOIN boards bo ON bo.id = b.board_id
		LEFT JOIN tasks t ON t.bucket_id = b.id
		WHERE bo.user_id = $1 AND b.id = $2
		GROUP BY b.id, bo.max_tasks_per_list
	`, userID, id)
	bucket, err := scanBucket(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Bucket{}, ErrNotFound
	}
	return bucket, err
}

func (s *Store) listBucketTasks(ctx context.Context, userID string, bucketID string) ([]Task, error) {
	rows, err := s.db.Query(ctx, `
		SELECT t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind, COALESCE(t.parent_task_id::text, ''), t.done,
			t.status, t.sort_order, t.created_at, t.updated_at
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		WHERE b.user_id = $1 AND t.bucket_id = $2
		ORDER BY t.sort_order, t.created_at
	`, userID, bucketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (s *Store) bucketFull(ctx context.Context, bucketID string) (bool, error) {
	return s.bucketFullExcept(ctx, bucketID, "")
}

func (s *Store) bucketFullExcept(ctx context.Context, bucketID string, taskID string) (bool, error) {
	var full bool
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(t.id) FILTER (
			WHERE t.kind = 'action' AND t.done = false
				AND ($2 = '' OR t.id <> NULLIF($2, '')::uuid)
		) >= bo.max_tasks_per_list
		FROM buckets b
		JOIN boards bo ON bo.id = b.board_id
		LEFT JOIN tasks t ON t.bucket_id = b.id
		WHERE b.id = $1
		GROUP BY b.id, bo.max_tasks_per_list
	`, bucketID, taskID).Scan(&full)
	return full, err
}

func (s *Store) validParent(ctx context.Context, userID string, bucketID string, parentID string, taskID string) (string, error) {
	parentID = clean(parentID)
	if parentID == "" {
		return "", nil
	}
	if parentID == taskID {
		return "", fmt.Errorf("%w: item cannot contain itself", ErrInvalidData)
	}
	parent, err := s.GetTask(ctx, userID, parentID)
	if err != nil {
		return "", err
	}
	if parent.BucketID != bucketID {
		return "", fmt.Errorf("%w: parent must be in the same list", ErrInvalidData)
	}
	if parent.ParentID != "" {
		return "", fmt.Errorf("%w: items support one level of nesting", ErrInvalidData)
	}
	if taskID != "" {
		hasChildren, err := s.taskHasChildren(ctx, userID, taskID)
		if err != nil {
			return "", err
		}
		if hasChildren {
			return "", fmt.Errorf("%w: an item with sub-items cannot become a sub-item", ErrInvalidData)
		}
	}
	return parentID, nil
}

func (s *Store) taskHasChildren(ctx context.Context, userID string, taskID string) (bool, error) {
	var hasChildren bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM tasks child
			JOIN boards b ON b.id = child.board_id
			WHERE b.user_id = $1 AND child.parent_task_id = $2
		)
	`, userID, taskID).Scan(&hasChildren)
	return hasChildren, err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanBoard(row rowScanner) (Board, error) {
	var board Board
	err := row.Scan(
		&board.ID, &board.Name, &board.BackgroundKind, &board.BackgroundValue,
		&board.MaxTasksPerList, &board.SortOrder, &board.CreatedAt, &board.UpdatedAt,
	)
	return board, err
}

func scanBucket(row rowScanner) (Bucket, error) {
	var bucket Bucket
	err := row.Scan(
		&bucket.ID, &bucket.BoardID, &bucket.Name, &bucket.Goal, &bucket.IsInbox, &bucket.LimitCount,
		&bucket.SortOrder, &bucket.OpenCount, &bucket.CreatedAt, &bucket.UpdatedAt,
	)
	return bucket, err
}

func scanTask(row rowScanner) (Task, error) {
	var task Task
	err := row.Scan(
		&task.ID, &task.BoardID, &task.BucketID, &task.Title, &task.Description, &task.ScheduledDate, &task.Kind, &task.ParentID, &task.Done,
		&task.Status,
		&task.SortOrder, &task.CreatedAt, &task.UpdatedAt,
	)
	return task, err
}

func clean(value string) string {
	return strings.TrimSpace(value)
}

func validDate(value string) (string, error) {
	value = clean(value)
	if value == "" {
		return "", nil
	}
	if _, err := time.Parse(time.DateOnly, value); err != nil {
		return "", fmt.Errorf("%w: date must use YYYY-MM-DD", ErrInvalidData)
	}
	return value, nil
}

func validStatus(status string) bool {
	switch status {
	case StatusQueued, StatusWorking, StatusNeedsReview, StatusDone:
		return true
	default:
		return false
	}
}

func validKind(kind string) bool {
	return kind == KindItem || kind == KindAction
}
