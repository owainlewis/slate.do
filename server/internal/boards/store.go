package boards

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/entitlements"
)

var (
	ErrNotFound        = errors.New("not found")
	ErrLimitFull       = errors.New("working limit reached")
	ErrBoardLimit      = errors.New("pro board limit reached")
	ErrListLimit       = errors.New("pro list limit reached")
	ErrActiveItemLimit = errors.New("pro active item limit reached")
	ErrInvalidData     = errors.New("invalid data")
	ErrTaskUnavailable = errors.New("task is not available")
	ErrIdempotencyKey  = errors.New("idempotency key already used with different task data")
	ErrIdempotencyGone = errors.New("task created by idempotency key was deleted")
)

const (
	defaultMaxBoards        = 5
	defaultMaxListsPerBoard = 9
	defaultMaxTasksPerList  = 20
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
	board, err := s.CreateBoard(ctx, userID, CreateBoardInput{Name: "Today"})
	if err != nil {
		return err
	}
	for _, bucket := range defaultBuckets() {
		if _, err := s.CreateBucket(ctx, userID, board.ID, bucket); err != nil {
			return err
		}
	}
	return nil
}

func defaultBuckets() []CreateBucketInput {
	return []CreateBucketInput{
		{Name: "Inbox", Goal: "Capture now, organise later", LimitCount: defaultMaxTasksPerList, IsInbox: true},
		{Name: "Product", Goal: "Make the thing more useful", LimitCount: defaultMaxTasksPerList},
		{Name: "Content", Goal: "Publish work that teaches or helps", LimitCount: defaultMaxTasksPerList},
		{Name: "Growth", Goal: "Reach and serve more people", LimitCount: defaultMaxTasksPerList},
		{Name: "Operations", Goal: "Keep everything running smoothly", LimitCount: defaultMaxTasksPerList},
	}
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

func (s *Store) GetBucket(ctx context.Context, userID string, id string) (Bucket, error) {
	bucket, err := s.getBucket(ctx, userID, id)
	if err != nil {
		return Bucket{}, err
	}
	tasks, err := s.listBucketTasks(ctx, userID, id)
	if err != nil {
		return Bucket{}, err
	}
	bucket.Tasks = tasks
	return bucket, nil
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
	if err := validateWorkingLimit(maxTasksPerList); err != nil {
		return Board{}, err
	}
	backgroundKind := clean(input.BackgroundKind)
	if backgroundKind == "" {
		backgroundKind = "plain"
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Board{}, err
	}
	defer tx.Rollback(ctx)
	var lockedUserID string
	if err := tx.QueryRow(ctx, "SELECT id::text FROM users WHERE id = $1 FOR UPDATE", userID).Scan(&lockedUserID); err != nil {
		return Board{}, err
	}
	var boardCount int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM boards WHERE user_id = $1", userID).Scan(&boardCount); err != nil {
		return Board{}, err
	}
	if boardCount >= defaultMaxBoards {
		return Board{}, ErrBoardLimit
	}
	var board Board
	err = tx.QueryRow(ctx, `
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
	if err != nil {
		return Board{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Board{}, err
	}
	return board, nil
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
		if err := validateWorkingLimit(*input.MaxTasksPerList); err != nil {
			return Board{}, err
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
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Bucket{}, err
	}
	defer tx.Rollback(ctx)
	var lockedBoardID string
	if err := tx.QueryRow(ctx, `
		SELECT id::text FROM boards
		WHERE id = $1 AND user_id = $2
		FOR UPDATE
	`, boardID, userID).Scan(&lockedBoardID); errors.Is(err, pgx.ErrNoRows) {
		return Bucket{}, ErrNotFound
	} else if err != nil {
		return Bucket{}, err
	}
	var listCount int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM buckets WHERE board_id = $1", boardID).Scan(&listCount); err != nil {
		return Bucket{}, err
	}
	if listCount >= defaultMaxListsPerBoard {
		return Bucket{}, ErrListLimit
	}
	var bucket Bucket
	err = tx.QueryRow(ctx, `
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
	if err != nil {
		return Bucket{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Bucket{}, err
	}
	return bucket, nil
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
	if input.IsInbox != nil {
		current.IsInbox = *input.IsInbox
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
		SET name = $3, goal = $4, limit_count = $5, is_inbox = $6, sort_order = $7, updated_at = now()
		FROM boards bo
		WHERE bo.id = b.board_id AND bo.user_id = $1 AND b.id = $2
		RETURNING b.id::text, b.board_id::text, b.name, b.goal, b.is_inbox, b.limit_count, b.sort_order, b.created_at, b.updated_at
	`, userID, id, current.Name, current.Goal, current.LimitCount, current.IsInbox, current.SortOrder).Scan(
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
		kind = KindAction
	}
	if !validKind(kind) {
		return Task{}, fmt.Errorf("%w: invalid item kind", ErrInvalidData)
	}
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if len(idempotencyKey) > 200 {
		return Task{}, fmt.Errorf("%w: idempotency key must be 200 characters or fewer", ErrInvalidData)
	}
	if idempotencyKey != "" {
		fingerprint, err := taskCreateFingerprint(bucketID, title, input.Description, scheduledDate, kind, input.OverrideLimit)
		if err != nil {
			return Task{}, err
		}
		return s.createTask(ctx, userID, bucketID, title, input.Description, scheduledDate, kind, idempotencyKey, fingerprint, input.OverrideLimit)
	}
	return s.createTask(ctx, userID, bucketID, title, input.Description, scheduledDate, kind, "", "", input.OverrideLimit)
}

func (s *Store) createTask(ctx context.Context, userID string, bucketID string, title string, description string, scheduledDate string, kind string, key string, fingerprint string, overrideLimit bool) (Task, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback(ctx)
	if key != "" {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", userID+":"+key); err != nil {
			return Task{}, err
		}
		var existingFingerprint, existingTaskID string
		err := tx.QueryRow(ctx, `
			SELECT request_hash, COALESCE(task_id::text, '')
			FROM task_idempotency_keys
			WHERE user_id = $1 AND key = $2
		`, userID, key).Scan(&existingFingerprint, &existingTaskID)
		if err == nil {
			if existingFingerprint != fingerprint {
				return Task{}, ErrIdempotencyKey
			}
			if existingTaskID == "" {
				return Task{}, ErrIdempotencyGone
			}
			return taskByID(ctx, tx, existingTaskID)
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return Task{}, err
		}
	}
	bucket, err := lockedBucket(ctx, tx, userID, bucketID)
	if err != nil {
		return Task{}, err
	}
	if err := checkTaskCapacity(ctx, tx, bucket, "", overrideLimit); err != nil {
		return Task{}, err
	}
	task, err := insertTask(ctx, tx, bucket, title, description, scheduledDate, kind)
	if err != nil {
		return Task{}, err
	}
	if key != "" {
		if _, err := tx.Exec(ctx, `
			INSERT INTO task_idempotency_keys (user_id, key, request_hash, task_id)
			VALUES ($1, $2, $3, $4)
		`, userID, key, fingerprint, task.ID); err != nil {
			return Task{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Task{}, err
	}
	return task, nil
}

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func insertTask(ctx context.Context, db queryRower, bucket Bucket, title string, description string, scheduledDate string, kind string) (Task, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, description, scheduled_date, kind, status, sort_order)
		VALUES (
			$1, $2, $3, $4, NULLIF($5, '')::date, $6, $7,
			COALESCE((SELECT max(sort_order) + 1 FROM tasks WHERE bucket_id = $2), 0)
		)
		RETURNING id::text, board_id::text, bucket_id::text, title, description,
			COALESCE(scheduled_date::text, ''), kind, done, status, sort_order, created_at, updated_at
	`, bucket.BoardID, bucket.ID, title, description, scheduledDate, kind, StatusQueued)
	return scanTask(row)
}

func taskByID(ctx context.Context, db queryRower, id string) (Task, error) {
	row := db.QueryRow(ctx, `
		SELECT id::text, board_id::text, bucket_id::text, title, description,
			COALESCE(scheduled_date::text, ''), kind, done,
			status, sort_order, created_at, updated_at
		FROM tasks
		WHERE id = $1
	`, id)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrIdempotencyGone
	}
	return task, err
}

func taskCreateFingerprint(bucketID string, title string, description string, scheduledDate string, kind string, overrideLimit bool) (string, error) {
	raw, err := json.Marshal(struct {
		BucketID      string `json:"bucketId"`
		Title         string `json:"title"`
		Description   string `json:"description"`
		ScheduledDate string `json:"scheduledDate"`
		Kind          string `json:"kind"`
		OverrideLimit bool   `json:"overrideLimit"`
	}{bucketID, title, description, scheduledDate, kind, overrideLimit})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func (s *Store) UpdateTask(ctx context.Context, userID string, id string, input UpdateTaskInput) (Task, error) {
	return s.updateTask(ctx, userID, id, input, false)
}

func (s *Store) UpdateTaskForHuman(ctx context.Context, userID string, id string, input UpdateTaskInput) (Task, error) {
	return s.updateTask(ctx, userID, id, input, true)
}

func (s *Store) MoveTask(ctx context.Context, userID string, id string, input MoveTaskInput) (Task, error) {
	bucketID := clean(input.BucketID)
	if bucketID == "" {
		return Task{}, fmt.Errorf("%w: destination list is required", ErrInvalidData)
	}
	if input.Position == nil || *input.Position < 0 {
		return Task{}, fmt.Errorf("%w: position must be zero or greater", ErrInvalidData)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback(ctx)

	// A user's moves are serialized so two cross-list moves cannot interleave
	// their source and destination order rewrites.
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", userID+":task-move"); err != nil {
		return Task{}, err
	}
	current, err := lockedTask(ctx, tx, userID, id)
	if err != nil {
		return Task{}, err
	}
	destination, err := lockedBucket(ctx, tx, userID, bucketID)
	if err != nil {
		return Task{}, err
	}
	if current.BucketID != destination.ID && current.Kind == KindAction && !current.Done {
		if err := checkTaskCapacity(ctx, tx, destination, current.ID, false); err != nil {
			return Task{}, err
		}
	}

	destinationIDs, err := orderedTaskIDs(ctx, tx, destination.ID, current.ID)
	if err != nil {
		return Task{}, err
	}
	if *input.Position > len(destinationIDs) {
		return Task{}, fmt.Errorf("%w: position is outside the destination list", ErrInvalidData)
	}
	destinationIDs = insertID(destinationIDs, current.ID, *input.Position)

	if current.BucketID != destination.ID {
		sourceIDs, err := orderedTaskIDs(ctx, tx, current.BucketID, current.ID)
		if err != nil {
			return Task{}, err
		}
		if err := updateTaskLocation(ctx, tx, current.ID, destination, *input.Position); err != nil {
			return Task{}, err
		}
		if err := writeTaskOrder(ctx, tx, sourceIDs); err != nil {
			return Task{}, err
		}
	}
	if err := writeTaskOrder(ctx, tx, destinationIDs); err != nil {
		return Task{}, err
	}

	moved, err := taskByID(ctx, tx, current.ID)
	if err != nil {
		return Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Task{}, err
	}
	return moved, nil
}

func orderedTaskIDs(ctx context.Context, tx pgx.Tx, bucketID string, exceptID string) ([]string, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text
		FROM tasks
		WHERE bucket_id = $1 AND id <> $2
		ORDER BY sort_order, created_at
		FOR UPDATE
	`, bucketID, exceptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func insertID(ids []string, id string, position int) []string {
	ids = append(ids, "")
	copy(ids[position+1:], ids[position:])
	ids[position] = id
	return ids
}

func updateTaskLocation(ctx context.Context, tx pgx.Tx, taskID string, destination Bucket, position int) error {
	_, err := tx.Exec(ctx, `
		UPDATE tasks
		SET board_id = $2, bucket_id = $3, sort_order = $4, updated_at = now()
		WHERE id = $1
	`, taskID, destination.BoardID, destination.ID, position)
	return err
}

func writeTaskOrder(ctx context.Context, tx pgx.Tx, ids []string) error {
	for position, id := range ids {
		if _, err := tx.Exec(ctx, "UPDATE tasks SET sort_order = $1, updated_at = now() WHERE id = $2", position, id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) updateTask(ctx context.Context, userID string, id string, input UpdateTaskInput, allowWorking bool) (Task, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback(ctx)
	current, err := lockedTask(ctx, tx, userID, id)
	if err != nil {
		return Task{}, err
	}
	originalBucketID := current.BucketID
	originalActive := current.Kind == KindAction && !current.Done
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
	}
	if input.BucketID != nil && *input.BucketID != current.BucketID {
		bucket, err := lockedBucket(ctx, tx, userID, *input.BucketID)
		if err != nil {
			return Task{}, err
		}
		current.BucketID = bucket.ID
		current.BoardID = bucket.BoardID
		current.SortOrder = 0
	}
	if input.Status != nil {
		if err := applyTaskStatus(&current, *input.Status, allowWorking); err != nil {
			return Task{}, err
		}
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
	currentActive := current.Kind == KindAction && !current.Done
	if currentActive && (!originalActive || originalBucketID != current.BucketID) {
		bucket, err := lockedBucket(ctx, tx, userID, current.BucketID)
		if err != nil {
			return Task{}, err
		}
		if err := checkTaskCapacity(ctx, tx, bucket, current.ID, false); err != nil {
			return Task{}, err
		}
	}
	row := tx.QueryRow(ctx, `
		UPDATE tasks t
		SET board_id = $3, bucket_id = $4, title = $5, description = $6,
			scheduled_date = NULLIF($7, '')::date, kind = $8,
			done = $9, status = $10, sort_order = $11, updated_at = now()
		FROM boards b
		WHERE b.id = t.board_id AND b.user_id = $1 AND t.id = $2
		RETURNING t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind, t.done,
			t.status, t.sort_order, t.created_at, t.updated_at
	`, userID, id, current.BoardID, current.BucketID, current.Title, current.Description, current.ScheduledDate, current.Kind, current.Done,
		current.Status, current.SortOrder)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	if err != nil {
		return Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Task{}, err
	}
	return task, nil
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
			COALESCE(t.scheduled_date::text, ''), t.kind, t.done,
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
			COALESCE(t.scheduled_date::text, ''), t.kind, t.done,
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
	if filter.BucketID != "" {
		args = append(args, filter.BucketID)
		doneSQL += fmt.Sprintf(" AND t.bucket_id = $%d", len(args))
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
			COALESCE(t.scheduled_date::text, ''), t.kind, t.done,
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

func lockedBucket(ctx context.Context, tx pgx.Tx, userID string, id string) (Bucket, error) {
	var bucket Bucket
	err := tx.QueryRow(ctx, `
		SELECT b.id::text, b.board_id::text, b.name, b.goal, b.is_inbox,
			bo.max_tasks_per_list, b.sort_order, b.created_at, b.updated_at
		FROM buckets b
		JOIN boards bo ON bo.id = b.board_id
		WHERE bo.user_id = $1 AND b.id = $2
		FOR UPDATE OF b
	`, userID, id).Scan(
		&bucket.ID, &bucket.BoardID, &bucket.Name, &bucket.Goal, &bucket.IsInbox,
		&bucket.LimitCount, &bucket.SortOrder, &bucket.CreatedAt, &bucket.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Bucket{}, ErrNotFound
	}
	return bucket, err
}

func lockedTask(ctx context.Context, tx pgx.Tx, userID string, id string) (Task, error) {
	row := tx.QueryRow(ctx, `
		SELECT t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind, t.done,
			t.status, t.sort_order, t.created_at, t.updated_at
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		WHERE b.user_id = $1 AND t.id = $2
		FOR UPDATE OF t
	`, userID, id)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	return task, err
}

func checkTaskCapacity(ctx context.Context, tx pgx.Tx, bucket Bucket, exceptTaskID string, overrideWorkingLimit bool) error {
	var activeCount int
	if err := tx.QueryRow(ctx, `
		SELECT count(*)
		FROM tasks
		WHERE bucket_id = $1 AND kind = 'action' AND done = false
			AND ($2 = '' OR id <> NULLIF($2, '')::uuid)
	`, bucket.ID, exceptTaskID).Scan(&activeCount); err != nil {
		return err
	}
	if activeCount >= entitlements.ProLimits.ActiveItemsPerList {
		return ErrActiveItemLimit
	}
	if !overrideWorkingLimit && activeCount >= bucket.LimitCount {
		return ErrLimitFull
	}
	return nil
}

func (s *Store) listBucketTasks(ctx context.Context, userID string, bucketID string) ([]Task, error) {
	rows, err := s.db.Query(ctx, `
		SELECT t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind, t.done,
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
		&task.ID, &task.BoardID, &task.BucketID, &task.Title, &task.Description, &task.ScheduledDate, &task.Kind, &task.Done,
		&task.Status,
		&task.SortOrder, &task.CreatedAt, &task.UpdatedAt,
	)
	return task, err
}

func clean(value string) string {
	return strings.TrimSpace(value)
}

func validateWorkingLimit(limit int) error {
	if limit < 1 {
		return fmt.Errorf("%w: Max active items per list must be positive", ErrInvalidData)
	}
	if limit > entitlements.ProLimits.ActiveItemsPerList {
		return fmt.Errorf("%w: Max active items per list cannot exceed the Pro maximum of %d", ErrInvalidData, entitlements.ProLimits.ActiveItemsPerList)
	}
	return nil
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

func applyTaskStatus(task *Task, status string, allowWorking bool) error {
	status = clean(status)
	if !validStatus(status) {
		return fmt.Errorf("%w: invalid status", ErrInvalidData)
	}
	if status == StatusWorking && !allowWorking {
		return fmt.Errorf("%w: working status requires claim", ErrInvalidData)
	}
	if task.Kind != KindAction {
		return fmt.Errorf("%w: only actions have workflow status", ErrInvalidData)
	}
	task.Status = status
	task.Done = status == StatusDone
	return nil
}

func validKind(kind string) bool {
	return kind == KindAction
}
