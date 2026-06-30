package boards

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/owainlewis/slate.do/server/internal/database"
)

var (
	ErrNotFound    = errors.New("not found")
	ErrLimitFull   = errors.New("bucket limit reached")
	ErrInvalidData = errors.New("invalid data")
)

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
	board, err := s.CreateBoard(ctx, userID, CreateBoardInput{Name: "Today", LayoutSize: 6})
	if err != nil {
		return err
	}
	defaults := []CreateBucketInput{
		{Name: "Inbox", LimitCount: 5, IsInbox: true},
		{Name: "Focus", LimitCount: 3},
		{Name: "Waiting", LimitCount: 5},
		{Name: "Agent work", LimitCount: 5},
		{Name: "Later", LimitCount: 5},
		{Name: "Done", LimitCount: 10},
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
		SELECT id::text, name, background_kind, background_value, layout_size, sort_order, created_at, updated_at
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
		SELECT id::text, name, background_kind, background_value, layout_size, sort_order, created_at, updated_at
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
	layout := input.LayoutSize
	if layout == 0 {
		layout = 6
	}
	if layout != 3 && layout != 6 {
		return Board{}, fmt.Errorf("%w: layout must be 3 or 6", ErrInvalidData)
	}
	backgroundKind := clean(input.BackgroundKind)
	if backgroundKind == "" {
		backgroundKind = "plain"
	}
	var board Board
	err := s.db.QueryRow(ctx, `
		INSERT INTO boards (user_id, name, background_kind, background_value, layout_size, sort_order)
		VALUES (
			$1, $2, $3, $4, $5,
			COALESCE((SELECT max(sort_order) + 1 FROM boards WHERE user_id = $1), 0)
		)
		RETURNING id::text, name, background_kind, background_value, layout_size, sort_order, created_at, updated_at
	`, userID, name, backgroundKind, input.BackgroundValue, layout).Scan(
		&board.ID, &board.Name, &board.BackgroundKind, &board.BackgroundValue,
		&board.LayoutSize, &board.SortOrder, &board.CreatedAt, &board.UpdatedAt,
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
	if input.LayoutSize != nil {
		if *input.LayoutSize != 3 && *input.LayoutSize != 6 {
			return Board{}, fmt.Errorf("%w: layout must be 3 or 6", ErrInvalidData)
		}
		current.LayoutSize = *input.LayoutSize
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
		SET name = $3, background_kind = $4, background_value = $5, layout_size = $6, sort_order = $7, updated_at = now()
		WHERE user_id = $1 AND id = $2
		RETURNING id::text, name, background_kind, background_value, layout_size, sort_order, created_at, updated_at
	`, userID, id, current.Name, current.BackgroundKind, current.BackgroundValue, current.LayoutSize, current.SortOrder).Scan(
		&board.ID, &board.Name, &board.BackgroundKind, &board.BackgroundValue,
		&board.LayoutSize, &board.SortOrder, &board.CreatedAt, &board.UpdatedAt,
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
		INSERT INTO buckets (board_id, name, is_inbox, limit_count, sort_order)
		VALUES (
			$1, $2, $3, $4,
			COALESCE((SELECT max(sort_order) + 1 FROM buckets WHERE board_id = $1), 0)
		)
		RETURNING id::text, board_id::text, name, is_inbox, limit_count, sort_order, created_at, updated_at
	`, boardID, name, input.IsInbox, limit).Scan(
		&bucket.ID, &bucket.BoardID, &bucket.Name, &bucket.IsInbox, &bucket.LimitCount,
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
		SET name = $3, limit_count = $4, sort_order = $5, updated_at = now()
		FROM boards bo
		WHERE bo.id = b.board_id AND bo.user_id = $1 AND b.id = $2
		RETURNING b.id::text, b.board_id::text, b.name, b.is_inbox, b.limit_count, b.sort_order, b.created_at, b.updated_at
	`, userID, id, current.Name, current.LimitCount, current.SortOrder).Scan(
		&bucket.ID, &bucket.BoardID, &bucket.Name, &bucket.IsInbox, &bucket.LimitCount,
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
	status := clean(input.Status)
	if status == "" {
		status = StatusQueued
	}
	if !validStatus(status) {
		return Task{}, fmt.Errorf("%w: invalid status", ErrInvalidData)
	}
	if !input.OverrideLimit {
		full, err := s.bucketFull(ctx, bucketID)
		if err != nil {
			return Task{}, err
		}
		if full {
			return Task{}, ErrLimitFull
		}
	}
	dueDate, err := parseDate(input.DueDate)
	if err != nil {
		return Task{}, err
	}
	row := s.db.QueryRow(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, focus, assignee, status, due_date, notes, agent_brief, sort_order)
		VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9,
			COALESCE((SELECT max(sort_order) + 1 FROM tasks WHERE bucket_id = $2), 0)
		)
		RETURNING id::text, board_id::text, bucket_id::text, title, done, focus, assignee, status, due_date, notes, agent_brief, sort_order, created_at, updated_at
	`, bucket.BoardID, bucketID, title, input.Focus, clean(input.Assignee), status, dueDate, input.Notes, input.AgentBrief)
	return scanTask(row)
}

func (s *Store) UpdateTask(ctx context.Context, userID string, id string, input UpdateTaskInput) (Task, error) {
	current, err := s.GetTask(ctx, userID, id)
	if err != nil {
		return Task{}, err
	}
	if input.Title != nil {
		current.Title = clean(*input.Title)
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
	if input.Done != nil {
		current.Done = *input.Done
		if current.Done {
			current.Status = StatusDone
		}
	}
	if input.Focus != nil {
		current.Focus = *input.Focus
	}
	if input.Assignee != nil {
		current.Assignee = clean(*input.Assignee)
	}
	if input.Status != nil {
		status := clean(*input.Status)
		if !validStatus(status) {
			return Task{}, fmt.Errorf("%w: invalid status", ErrInvalidData)
		}
		current.Status = status
		current.Done = status == StatusDone
	}
	if input.DueDate != nil {
		current.DueDate = clean(*input.DueDate)
	}
	if input.Notes != nil {
		current.Notes = *input.Notes
	}
	if input.AgentBrief != nil {
		current.AgentBrief = *input.AgentBrief
	}
	if input.SortOrder != nil {
		current.SortOrder = *input.SortOrder
	}
	if current.Title == "" {
		return Task{}, fmt.Errorf("%w: task title is required", ErrInvalidData)
	}
	dueDate, err := parseDate(current.DueDate)
	if err != nil {
		return Task{}, err
	}
	row := s.db.QueryRow(ctx, `
		UPDATE tasks t
		SET board_id = $3, bucket_id = $4, title = $5, done = $6, focus = $7,
			assignee = $8, status = $9, due_date = $10, notes = $11,
			agent_brief = $12, sort_order = $13, updated_at = now()
		FROM boards b
		WHERE b.id = t.board_id AND b.user_id = $1 AND t.id = $2
		RETURNING t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.done, t.focus,
			t.assignee, t.status, t.due_date, t.notes, t.agent_brief, t.sort_order, t.created_at, t.updated_at
	`, userID, id, current.BoardID, current.BucketID, current.Title, current.Done, current.Focus,
		current.Assignee, current.Status, dueDate, current.Notes, current.AgentBrief, current.SortOrder)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrNotFound
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
		tag, err := tx.Exec(ctx, "UPDATE tasks SET sort_order = $1, bucket_id = $2, updated_at = now() WHERE id = $3", i, bucketID, id)
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
		SELECT t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.done, t.focus,
			t.assignee, t.status, t.due_date, t.notes, t.agent_brief, t.sort_order, t.created_at, t.updated_at
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
	if filter.Assignee != "" {
		args = append(args, filter.Assignee)
		doneSQL += fmt.Sprintf(" AND t.assignee = $%d", len(args))
	}
	if filter.Status != "" {
		args = append(args, filter.Status)
		doneSQL += fmt.Sprintf(" AND t.status = $%d", len(args))
	}
	if filter.Done != nil {
		args = append(args, *filter.Done)
		doneSQL += fmt.Sprintf(" AND t.done = $%d", len(args))
	}
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	args = append(args, limit)
	query := `
		SELECT t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.done, t.focus,
			t.assignee, t.status, t.due_date, t.notes, t.agent_brief, t.sort_order, t.created_at, t.updated_at
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
		SELECT b.id::text, b.board_id::text, b.name, b.is_inbox, b.limit_count, b.sort_order,
			COUNT(t.id) FILTER (WHERE t.done = false)::int AS open_count,
			b.created_at, b.updated_at
		FROM buckets b
		JOIN boards bo ON bo.id = b.board_id
		LEFT JOIN tasks t ON t.bucket_id = b.id
		WHERE bo.user_id = $1 AND b.board_id = $2
		GROUP BY b.id
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
		SELECT b.id::text, b.board_id::text, b.name, b.is_inbox, b.limit_count, b.sort_order,
			COUNT(t.id) FILTER (WHERE t.done = false)::int AS open_count,
			b.created_at, b.updated_at
		FROM buckets b
		JOIN boards bo ON bo.id = b.board_id
		LEFT JOIN tasks t ON t.bucket_id = b.id
		WHERE bo.user_id = $1 AND b.id = $2
		GROUP BY b.id
	`, userID, id)
	bucket, err := scanBucket(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Bucket{}, ErrNotFound
	}
	return bucket, err
}

func (s *Store) listBucketTasks(ctx context.Context, userID string, bucketID string) ([]Task, error) {
	rows, err := s.db.Query(ctx, `
		SELECT t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.done, t.focus,
			t.assignee, t.status, t.due_date, t.notes, t.agent_brief, t.sort_order, t.created_at, t.updated_at
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
	var full bool
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(t.id) FILTER (WHERE t.done = false) >= b.limit_count
		FROM buckets b
		LEFT JOIN tasks t ON t.bucket_id = b.id
		WHERE b.id = $1
		GROUP BY b.id
	`, bucketID).Scan(&full)
	return full, err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanBoard(row rowScanner) (Board, error) {
	var board Board
	err := row.Scan(
		&board.ID, &board.Name, &board.BackgroundKind, &board.BackgroundValue,
		&board.LayoutSize, &board.SortOrder, &board.CreatedAt, &board.UpdatedAt,
	)
	return board, err
}

func scanBucket(row rowScanner) (Bucket, error) {
	var bucket Bucket
	err := row.Scan(
		&bucket.ID, &bucket.BoardID, &bucket.Name, &bucket.IsInbox, &bucket.LimitCount,
		&bucket.SortOrder, &bucket.OpenCount, &bucket.CreatedAt, &bucket.UpdatedAt,
	)
	return bucket, err
}

func scanTask(row rowScanner) (Task, error) {
	var task Task
	var due pgtype.Date
	err := row.Scan(
		&task.ID, &task.BoardID, &task.BucketID, &task.Title, &task.Done, &task.Focus,
		&task.Assignee, &task.Status, &due, &task.Notes, &task.AgentBrief,
		&task.SortOrder, &task.CreatedAt, &task.UpdatedAt,
	)
	if err != nil {
		return Task{}, err
	}
	if due.Valid {
		task.DueDate = due.Time.Format("2006-01-02")
	}
	return task, nil
}

func parseDate(value string) (*time.Time, error) {
	value = clean(value)
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return nil, fmt.Errorf("%w: due date must be YYYY-MM-DD", ErrInvalidData)
	}
	return &parsed, nil
}

func clean(value string) string {
	return strings.TrimSpace(value)
}

func validStatus(status string) bool {
	switch status {
	case StatusQueued, StatusWorking, StatusNeedsReview, StatusDone:
		return true
	default:
		return false
	}
}
