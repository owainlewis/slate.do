package boards

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/entitlements"
	"github.com/owainlewis/slate.do/server/internal/httpapi"
)

var (
	ErrNotFound        = errors.New("not found")
	ErrLimitFull       = errors.New("working limit reached")
	ErrBoardLimit      = errors.New("board limit reached")
	ErrListLimit       = errors.New("list limit reached")
	ErrActiveItemLimit = errors.New("active item limit reached")
	ErrInvalidData     = errors.New("invalid data")
	ErrTaskUnavailable = errors.New("task is not available")
	ErrIdempotencyKey  = errors.New("idempotency key already used with different data")
	ErrIdempotencyGone = errors.New("task created by idempotency key was deleted")
	ErrAgentTaskScope  = errors.New("agent credentials cannot move, reorder, or reassign tasks")
)

const (
	defaultCompletedHistoryLimit = 20
	maxCompletedHistoryLimit     = 100
)

const inboxCaptureFingerprintTarget = "account-inbox"

type completedTaskCursor struct {
	UpdatedAt time.Time `json:"updatedAt"`
	ID        string    `json:"id"`
	Scope     string    `json:"scope"`
}

var (
	defaultMaxBoards        = entitlements.ProLimits.Boards
	defaultMaxListsPerBoard = entitlements.ProLimits.ListsPerBoard
	defaultMaxTasksPerList  = entitlements.ProLimits.ActiveItemsPerList
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

func (s *Store) ListBoardsForAgent(ctx context.Context, userID string, agentID string) ([]Board, error) {
	rows, err := s.db.Query(ctx, `
		SELECT b.id::text, b.name, b.background_kind, b.background_value, b.max_tasks_per_list, b.sort_order, b.created_at, b.updated_at
		FROM boards b
		WHERE b.user_id = $1
			AND EXISTS (
				SELECT 1
				FROM tasks t
				WHERE t.board_id = b.id AND t.assignee_agent_id = $2
			)
		ORDER BY b.sort_order, b.created_at
	`, userID, agentID)
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

func (s *Store) ListAllBuckets(ctx context.Context, userID string) ([]Bucket, error) {
	rows, err := s.db.Query(ctx, `
		SELECT l.id::text, l.board_id::text, l.name, l.goal, l.is_inbox, b.max_tasks_per_list, l.sort_order,
			COUNT(t.id) FILTER (WHERE t.kind = 'action' AND t.done = false)::int AS open_count,
			l.created_at, l.updated_at, b.name
		FROM buckets l
		JOIN boards b ON b.id = l.board_id
		LEFT JOIN tasks t ON t.bucket_id = l.id
		WHERE b.user_id = $1
		GROUP BY l.id, b.max_tasks_per_list, b.name, b.sort_order, b.created_at
		ORDER BY b.sort_order, b.created_at, l.sort_order, l.created_at
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var lists []Bucket
	for rows.Next() {
		var list Bucket
		if err := rows.Scan(
			&list.ID, &list.BoardID, &list.Name, &list.Goal, &list.IsInbox, &list.LimitCount,
			&list.SortOrder, &list.OpenCount, &list.CreatedAt, &list.UpdatedAt, &list.BoardName,
		); err != nil {
			return nil, err
		}
		lists = append(lists, list)
	}
	if lists == nil {
		lists = []Bucket{}
	}
	return lists, rows.Err()
}

func (s *Store) InboxBucketID(ctx context.Context, userID string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx, `
		SELECT l.id::text
		FROM buckets l
		JOIN boards b ON b.id = l.board_id
		WHERE b.user_id = $1 AND l.is_inbox = true
		ORDER BY b.sort_order, b.created_at, l.sort_order, l.created_at
		LIMIT 1
	`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

// EnsureInboxBucketID repairs the valid empty-account states left by older
// clients and returns an Inbox for universal capture. The account lock is shared
// with board, list, and task writes, so concurrent first-task requests cannot
// create duplicate defaults.
func (s *Store) EnsureInboxBucketID(ctx context.Context, userID string) (string, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	inboxID, err := ensureInboxBucketID(ctx, tx, userID)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return inboxID, nil
}

func ensureInboxBucketID(ctx context.Context, tx pgx.Tx, userID string) (string, error) {
	if _, err := accountLimitsForUpdate(ctx, tx, userID); err != nil {
		return "", err
	}

	var inboxID string
	var err error
	err = tx.QueryRow(ctx, `
		SELECT l.id::text
		FROM buckets l
		JOIN boards b ON b.id = l.board_id
		WHERE b.user_id = $1 AND l.is_inbox = true
		ORDER BY b.sort_order, b.created_at, b.id, l.sort_order, l.created_at, l.id
		LIMIT 1
		FOR UPDATE OF l
	`, userID).Scan(&inboxID)
	if err == nil {
		return inboxID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	var firstListID string
	err = tx.QueryRow(ctx, `
		SELECT l.id::text
		FROM buckets l
		JOIN boards b ON b.id = l.board_id
		WHERE b.user_id = $1
		ORDER BY b.sort_order, b.created_at, b.id, l.sort_order, l.created_at, l.id
		LIMIT 1
		FOR UPDATE OF l
	`, userID).Scan(&firstListID)
	if err == nil {
		if _, err := tx.Exec(ctx, "UPDATE buckets SET is_inbox = true, updated_at = now() WHERE id = $1", firstListID); err != nil {
			return "", err
		}
		return firstListID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	var boardID string
	var listLimit int
	err = tx.QueryRow(ctx, `
		SELECT id::text, max_tasks_per_list
		FROM boards
		WHERE user_id = $1
		ORDER BY sort_order, created_at, id
		LIMIT 1
		FOR UPDATE
	`, userID).Scan(&boardID, &listLimit)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
			INSERT INTO boards (user_id, name, max_tasks_per_list, sort_order)
			VALUES ($1, 'Today', $2, 0)
			RETURNING id::text, max_tasks_per_list
		`, userID, defaultMaxTasksPerList).Scan(&boardID, &listLimit)
	}
	if err != nil {
		return "", err
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO buckets (board_id, name, goal, is_inbox, limit_count, sort_order)
		VALUES ($1, 'Inbox', 'Capture now, organise later', true, $2, 0)
		RETURNING id::text
	`, boardID, listLimit).Scan(&inboxID)
	if err != nil {
		return "", err
	}
	return inboxID, nil
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
		tasks, nextCursor, err := s.listBucketTasks(ctx, userID, buckets[i].ID)
		if err != nil {
			return Board{}, err
		}
		buckets[i].Tasks = tasks
		buckets[i].CompletedNextCursor = nextCursor
	}
	board.Buckets = buckets
	return board, nil
}

func (s *Store) GetBoardForAgent(ctx context.Context, userID string, agentID string, id string) (Board, error) {
	row := s.db.QueryRow(ctx, `
		SELECT b.id::text, b.name, b.background_kind, b.background_value, b.max_tasks_per_list, b.sort_order, b.created_at, b.updated_at
		FROM boards b
		WHERE b.user_id = $1 AND b.id = $2
			AND EXISTS (
				SELECT 1
				FROM tasks t
				WHERE t.board_id = b.id AND t.assignee_agent_id = $3
			)
	`, userID, id, agentID)
	board, err := scanBoard(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Board{}, ErrNotFound
	}
	if err != nil {
		return Board{}, err
	}
	board.Buckets, err = s.listBucketsForAgent(ctx, userID, agentID, id)
	if err != nil {
		return Board{}, err
	}
	return board, nil
}

func (s *Store) GetBucket(ctx context.Context, userID string, id string) (Bucket, error) {
	bucket, err := s.getBucket(ctx, userID, id)
	if err != nil {
		return Bucket{}, err
	}
	tasks, nextCursor, err := s.listBucketTasks(ctx, userID, id)
	if err != nil {
		return Bucket{}, err
	}
	bucket.Tasks = tasks
	bucket.CompletedNextCursor = nextCursor
	return bucket, nil
}

func (s *Store) GetBucketForAgent(ctx context.Context, userID string, agentID string, id string) (Bucket, error) {
	row := s.db.QueryRow(ctx, `
		SELECT b.id::text, b.board_id::text, b.name, b.goal, b.is_inbox, bo.max_tasks_per_list, b.sort_order,
			COUNT(t.id) FILTER (WHERE t.kind = 'action' AND t.done = false)::int AS open_count,
			b.created_at, b.updated_at
		FROM buckets b
		JOIN boards bo ON bo.id = b.board_id
		JOIN tasks t ON t.board_id = b.board_id AND t.bucket_id = b.id AND t.assignee_agent_id = $3
		WHERE bo.user_id = $1 AND b.id = $2
		GROUP BY b.id, bo.max_tasks_per_list
	`, userID, id, agentID)
	bucket, err := scanBucket(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Bucket{}, ErrNotFound
	}
	return bucket, err
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
	limits, err := accountLimitsForUpdate(ctx, tx, userID)
	if err != nil {
		return Board{}, err
	}
	var boardCount int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM boards WHERE user_id = $1", userID).Scan(&boardCount); err != nil {
		return Board{}, err
	}
	if boardCount >= limits.Boards {
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
	var ownedID string
	if err := s.db.QueryRow(ctx, "SELECT id::text FROM boards WHERE user_id = $1 AND id = $2", userID, id).Scan(&ownedID); errors.Is(err, pgx.ErrNoRows) {
		return Board{}, ErrNotFound
	} else if err != nil {
		return Board{}, err
	}

	var name *string
	if input.Name != nil {
		value := clean(*input.Name)
		if value == "" {
			return Board{}, fmt.Errorf("%w: board name is required", ErrInvalidData)
		}
		name = &value
	}

	var backgroundKind *string
	if input.BackgroundKind != nil {
		value := clean(*input.BackgroundKind)
		if value == "" {
			value = "plain"
		}
		backgroundKind = &value
	}
	if input.MaxTasksPerList != nil {
		if err := validateWorkingLimit(*input.MaxTasksPerList); err != nil {
			return Board{}, err
		}
	}

	var board Board
	err := s.db.QueryRow(ctx, `
		UPDATE boards
		SET name = COALESCE($3::text, name),
		    background_kind = COALESCE($4::text, background_kind),
		    background_value = COALESCE($5::text, background_value),
		    max_tasks_per_list = COALESCE($6::integer, max_tasks_per_list),
		    sort_order = COALESCE($7::integer, sort_order),
		    updated_at = now()
		WHERE user_id = $1 AND id = $2
		RETURNING id::text, name, background_kind, background_value, max_tasks_per_list, sort_order, created_at, updated_at
	`, userID, id, name, backgroundKind, input.BackgroundValue, input.MaxTasksPerList, input.SortOrder).Scan(
		&board.ID, &board.Name, &board.BackgroundKind, &board.BackgroundValue,
		&board.MaxTasksPerList, &board.SortOrder, &board.CreatedAt, &board.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Board{}, ErrNotFound
	}
	return board, err
}

func (s *Store) DeleteBoard(ctx context.Context, userID string, id string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	quota, err := lockStorageQuota(ctx, tx, userID)
	if err != nil {
		return err
	}
	var boardID string
	if err := tx.QueryRow(ctx, "SELECT id::text FROM boards WHERE user_id = $1 AND id = $2 FOR UPDATE", userID, id).Scan(&boardID); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	var containsInbox bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM buckets WHERE board_id = $1 AND is_inbox = true)", boardID).Scan(&containsInbox); err != nil {
		return err
	}
	if containsInbox {
		if err := ensureInboxSurvives(ctx, tx, userID, "", boardID); err != nil {
			return err
		}
	}
	usage, err := lockedBoardTaskStorage(ctx, tx, boardID)
	if err != nil {
		return err
	}
	if err := quota.apply(ctx, tx, -usage.Tasks, -usage.ContentBytes); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, "DELETE FROM boards WHERE id = $1", boardID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return tx.Commit(ctx)
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
	limits, err := accountLimitsForUpdate(ctx, tx, userID)
	if err != nil {
		return Bucket{}, err
	}
	var lockedBoardID string
	if err := tx.QueryRow(ctx, `
		SELECT b.id::text
		FROM boards b
		JOIN users u ON u.id = b.user_id
		WHERE b.id = $1 AND b.user_id = $2 AND u.disabled_at IS NULL
		FOR UPDATE OF b
	`, boardID, userID).Scan(&lockedBoardID); errors.Is(err, pgx.ErrNoRows) {
		return Bucket{}, ErrNotFound
	} else if err != nil {
		return Bucket{}, err
	}
	var listCount int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM buckets WHERE board_id = $1", boardID).Scan(&listCount); err != nil {
		return Bucket{}, err
	}
	if listCount >= limits.ListsPerBoard {
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
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Bucket{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := lockStorageQuota(ctx, tx, userID); err != nil {
		return Bucket{}, err
	}
	current, err := lockedBucket(ctx, tx, userID, id)
	if err != nil {
		return Bucket{}, err
	}
	wasInbox := current.IsInbox
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
	if wasInbox && !current.IsInbox {
		if err := ensureInboxSurvives(ctx, tx, userID, current.ID, ""); err != nil {
			return Bucket{}, err
		}
	}
	var bucket Bucket
	err = tx.QueryRow(ctx, `
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
	if err != nil {
		return Bucket{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Bucket{}, err
	}
	return bucket, nil
}

func (s *Store) DeleteBucket(ctx context.Context, userID string, id string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	quota, err := lockStorageQuota(ctx, tx, userID)
	if err != nil {
		return err
	}
	var bucketID string
	var isInbox bool
	if err := tx.QueryRow(ctx, `
		SELECT b.id::text, b.is_inbox
		FROM buckets b
		JOIN boards bo ON bo.id = b.board_id
		WHERE bo.user_id = $1 AND b.id = $2
		FOR UPDATE OF b
	`, userID, id).Scan(&bucketID, &isInbox); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if isInbox {
		if err := ensureInboxSurvives(ctx, tx, userID, bucketID, ""); err != nil {
			return err
		}
	}
	usage, err := lockedBucketTaskStorage(ctx, tx, bucketID)
	if err != nil {
		return err
	}
	if err := quota.apply(ctx, tx, -usage.Tasks, -usage.ContentBytes); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, "DELETE FROM buckets WHERE id = $1", bucketID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return tx.Commit(ctx)
}

func ensureInboxSurvives(ctx context.Context, tx pgx.Tx, userID string, excludedBucketID string, excludedBoardID string) error {
	var survives bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM buckets l
			JOIN boards b ON b.id = l.board_id
			WHERE b.user_id = $1
				AND l.is_inbox = true
				AND ($2 = '' OR l.id <> $2::uuid)
				AND ($3 = '' OR b.id <> $3::uuid)
		)
	`, userID, excludedBucketID, excludedBoardID).Scan(&survives)
	if err != nil {
		return err
	}
	if !survives {
		return fmt.Errorf("%w: the account must keep an Inbox list", ErrInvalidData)
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

func (s *Store) CreateInboxTask(ctx context.Context, userID string, input CreateTaskInput) (Task, error) {
	prepared, err := prepareTaskCreate(input, inboxCaptureFingerprintTarget)
	if err != nil {
		return Task{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback(ctx)
	// Explicit-list creation takes the idempotency lock before the account lock.
	// Keep the same order here so one key used across endpoints cannot deadlock.
	if prepared.idempotencyKey != "" {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", userID+":"+prepared.idempotencyKey); err != nil {
			return Task{}, err
		}
	}
	bucketID, err := ensureInboxBucketID(ctx, tx, userID)
	if err != nil {
		return Task{}, err
	}
	task, err := s.createTask(ctx, tx, userID, bucketID, prepared)
	if err != nil {
		return Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Task{}, err
	}
	return task, nil
}

func (s *Store) CreateTask(ctx context.Context, userID string, bucketID string, input CreateTaskInput) (Task, error) {
	return s.createTaskForTarget(ctx, userID, bucketID, bucketID, input)
}

func (s *Store) createTaskForTarget(ctx context.Context, userID string, bucketID string, fingerprintTarget string, input CreateTaskInput) (Task, error) {
	prepared, err := prepareTaskCreate(input, fingerprintTarget)
	if err != nil {
		return Task{}, err
	}
	return s.createPreparedTask(ctx, userID, bucketID, prepared)
}

func (s *Store) createPreparedTask(ctx context.Context, userID string, bucketID string, prepared preparedTaskCreate) (Task, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback(ctx)
	task, err := s.createTask(ctx, tx, userID, bucketID, prepared)
	if err != nil {
		return Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Task{}, err
	}
	return task, nil
}

type preparedTaskCreate struct {
	title                  string
	description            string
	scheduledDate          string
	kind                   string
	assigneeAgentID        string
	parentTaskID           string
	idempotencyKey         string
	fingerprint            string
	compatibleFingerprints []string
	overrideLimit          bool
}

func prepareTaskCreate(input CreateTaskInput, fingerprintTarget string) (preparedTaskCreate, error) {
	title := clean(input.Title)
	if title == "" {
		return preparedTaskCreate{}, fmt.Errorf("%w: task title is required", ErrInvalidData)
	}
	scheduledDate, err := validDate(input.ScheduledDate)
	if err != nil {
		return preparedTaskCreate{}, err
	}
	kind := clean(input.Kind)
	if kind == "" {
		kind = KindAction
	}
	if !validKind(kind) {
		return preparedTaskCreate{}, fmt.Errorf("%w: invalid item kind", ErrInvalidData)
	}
	parentTaskID := clean(input.ParentTaskID)
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if len(idempotencyKey) > httpapi.TaskIdempotencyBytes {
		return preparedTaskCreate{}, fmt.Errorf("%w: idempotency key must be %d UTF-8 bytes or fewer", ErrInvalidData, httpapi.TaskIdempotencyBytes)
	}
	prepared := preparedTaskCreate{
		title: title, description: input.Description, scheduledDate: scheduledDate, kind: kind,
		assigneeAgentID: input.AssigneeAgentID, parentTaskID: parentTaskID,
		idempotencyKey: idempotencyKey, overrideLimit: input.OverrideLimit,
	}
	if idempotencyKey != "" {
		fingerprint, err := taskCreateFingerprint(fingerprintTarget, title, input.Description, scheduledDate, kind, input.AssigneeAgentID, parentTaskID, input.OverrideLimit)
		if err != nil {
			return preparedTaskCreate{}, err
		}
		prepared.fingerprint = fingerprint
		if parentTaskID == "" {
			compatibleFingerprint, err := parentAwareTaskCreateFingerprint(fingerprintTarget, title, input.Description, scheduledDate, kind, input.AssigneeAgentID, "", input.OverrideLimit)
			if err != nil {
				return preparedTaskCreate{}, err
			}
			prepared.compatibleFingerprints = append(prepared.compatibleFingerprints, compatibleFingerprint)
		}
	}
	return prepared, nil
}

func (s *Store) CreateSubtask(ctx context.Context, userID string, parentTaskID string, input CreateTaskInput) (Task, error) {
	parent, err := s.GetTask(ctx, userID, parentTaskID)
	if err != nil {
		return Task{}, err
	}
	if parent.ParentTaskID != "" {
		return Task{}, fmt.Errorf("%w: subtasks cannot contain subtasks", ErrInvalidData)
	}
	input.ParentTaskID = parent.ID
	prepared, err := prepareTaskCreate(input, "parent:"+parent.ID)
	if err != nil {
		return Task{}, err
	}
	if prepared.idempotencyKey != "" {
		rows, err := s.db.Query(ctx, `
			SELECT b.id::text
			FROM buckets b
			JOIN boards bo ON bo.id = b.board_id
			WHERE bo.user_id = $1
		`, userID)
		if err != nil {
			return Task{}, err
		}
		defer rows.Close()
		for rows.Next() {
			var bucketID string
			if err := rows.Scan(&bucketID); err != nil {
				return Task{}, err
			}
			fingerprint, err := parentAwareTaskCreateFingerprint(
				bucketID,
				prepared.title,
				prepared.description,
				prepared.scheduledDate,
				prepared.kind,
				prepared.assigneeAgentID,
				prepared.parentTaskID,
				prepared.overrideLimit,
			)
			if err != nil {
				return Task{}, err
			}
			prepared.compatibleFingerprints = append(prepared.compatibleFingerprints, fingerprint)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return Task{}, err
		}
		rows.Close()
	}
	return s.createPreparedTask(ctx, userID, parent.BucketID, prepared)
}

func (s *Store) createTask(ctx context.Context, tx pgx.Tx, userID string, bucketID string, input preparedTaskCreate) (Task, error) {
	if input.idempotencyKey != "" {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", userID+":"+input.idempotencyKey); err != nil {
			return Task{}, err
		}
		var existingFingerprint, existingTaskID string
		err := tx.QueryRow(ctx, `
			SELECT request_hash, COALESCE(task_id::text, '')
			FROM task_idempotency_keys
			WHERE user_id = $1 AND key = $2
		`, userID, input.idempotencyKey).Scan(&existingFingerprint, &existingTaskID)
		if err == nil {
			fingerprintMatches := existingFingerprint == input.fingerprint
			for _, compatibleFingerprint := range input.compatibleFingerprints {
				if existingFingerprint == compatibleFingerprint {
					fingerprintMatches = true
					break
				}
			}
			if !fingerprintMatches {
				if input.parentTaskID != "" && existingTaskID != "" {
					existingTask, err := taskByID(ctx, tx, existingTaskID)
					if err != nil {
						return Task{}, err
					}
					if subtaskMatchesCreateInput(existingTask, input) {
						return existingTask, nil
					}
				}
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
	quota, err := lockStorageQuota(ctx, tx, userID)
	if err != nil {
		return Task{}, err
	}
	if input.parentTaskID != "" {
		parent, err := lockedTask(ctx, tx, userID, input.parentTaskID)
		if err != nil {
			return Task{}, err
		}
		if parent.ParentTaskID != "" {
			return Task{}, fmt.Errorf("%w: subtasks cannot contain subtasks", ErrInvalidData)
		}
		if parent.BucketID != bucketID {
			return Task{}, fmt.Errorf("%w: subtask must use its parent list", ErrInvalidData)
		}
	}
	bucket, err := lockedBucket(ctx, tx, userID, bucketID)
	if err != nil {
		return Task{}, err
	}
	if err := checkTaskCapacity(ctx, tx, bucket, "", input.overrideLimit); err != nil {
		return Task{}, err
	}
	if err := quota.apply(ctx, tx, 1, inputContentBytes(input.title, input.description)); err != nil {
		return Task{}, err
	}
	assigneeAgentID, err := activeAgentAssignment(ctx, tx, userID, input.assigneeAgentID)
	if err != nil {
		return Task{}, err
	}
	task, err := insertTask(ctx, tx, bucket, input.title, input.description, input.scheduledDate, input.kind, assigneeAgentID, input.parentTaskID)
	if err != nil {
		return Task{}, err
	}
	if input.idempotencyKey != "" {
		if _, err := tx.Exec(ctx, `
			INSERT INTO task_idempotency_keys (user_id, key, request_hash, task_id)
			VALUES ($1, $2, $3, $4)
		`, userID, input.idempotencyKey, input.fingerprint, task.ID); err != nil {
			return Task{}, err
		}
	}
	return task, nil
}

func subtaskMatchesCreateInput(task Task, input preparedTaskCreate) bool {
	return task.ParentTaskID == input.parentTaskID &&
		task.Title == input.title &&
		task.Description == input.description &&
		task.ScheduledDate == input.scheduledDate &&
		task.Kind == input.kind &&
		task.AssigneeAgentID == input.assigneeAgentID
}

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func activeAgentAssignment(ctx context.Context, db queryRower, userID string, agentID string) (string, error) {
	agentID = clean(agentID)
	if agentID == "" {
		return "", nil
	}
	if !validUUID(agentID) {
		return "", fmt.Errorf("%w: agent assignee not found", ErrInvalidData)
	}
	var id string
	err := db.QueryRow(ctx, `
		SELECT id::text
		FROM agents
		WHERE owner_user_id = $1 AND id = $2 AND archived_at IS NULL
		FOR KEY SHARE
	`, userID, agentID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("%w: agent assignee not found", ErrInvalidData)
	}
	return id, err
}

func validUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		switch index {
		case 8, 13, 18, 23:
			if character != '-' {
				return false
			}
		default:
			if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')) {
				return false
			}
		}
	}
	return true
}

func insertTask(ctx context.Context, db queryRower, bucket Bucket, title string, description string, scheduledDate string, kind string, assigneeAgentID string, parentTaskID string) (Task, error) {
	row := db.QueryRow(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, description, scheduled_date, kind, status, assignee_agent_id, parent_task_id, sort_order)
		VALUES (
			$1, $2, $3, $4, NULLIF($5, '')::date, $6, $7, NULLIF($8, '')::uuid, NULLIF($9, '')::uuid,
			COALESCE((SELECT max(sort_order) + 1 FROM tasks WHERE bucket_id = $2), 0)
		)
		RETURNING id::text, board_id::text, bucket_id::text, title, description,
			COALESCE(scheduled_date::text, ''), kind, done, status, priority, sort_order, created_at, updated_at
			, COALESCE(assignee_agent_id::text, ''), COALESCE(parent_task_id::text, '')
	`, bucket.BoardID, bucket.ID, title, description, scheduledDate, kind, StatusNew, assigneeAgentID, parentTaskID)
	return scanTask(row)
}

func taskByID(ctx context.Context, db queryRower, id string) (Task, error) {
	row := db.QueryRow(ctx, `
		SELECT id::text, board_id::text, bucket_id::text, title, description,
			COALESCE(scheduled_date::text, ''), kind, done,
			status, priority, sort_order, created_at, updated_at, COALESCE(assignee_agent_id::text, ''), COALESCE(parent_task_id::text, '')
		FROM tasks
		WHERE id = $1
	`, id)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrIdempotencyGone
	}
	return task, err
}

func taskCreateFingerprint(bucketID string, title string, description string, scheduledDate string, kind string, assigneeAgentID string, parentTaskID string, overrideLimit bool) (string, error) {
	// Keep the original top-level task payload byte-for-byte compatible with
	// fingerprints stored before subtasks were introduced. Idempotency keys live
	// for seven days, so adding an empty parentTaskId field here would turn valid
	// retries during a rolling deployment into conflicts.
	if parentTaskID == "" {
		return topLevelTaskCreateFingerprint(bucketID, title, description, scheduledDate, kind, assigneeAgentID, overrideLimit)
	}
	return parentAwareTaskCreateFingerprint(bucketID, title, description, scheduledDate, kind, assigneeAgentID, parentTaskID, overrideLimit)
}

func parentAwareTaskCreateFingerprint(bucketID string, title string, description string, scheduledDate string, kind string, assigneeAgentID string, parentTaskID string, overrideLimit bool) (string, error) {
	raw, err := json.Marshal(struct {
		BucketID        string `json:"bucketId"`
		Title           string `json:"title"`
		Description     string `json:"description"`
		ScheduledDate   string `json:"scheduledDate"`
		Kind            string `json:"kind"`
		AssigneeAgentID string `json:"assigneeAgentId"`
		ParentTaskID    string `json:"parentTaskId"`
		OverrideLimit   bool   `json:"overrideLimit"`
	}{bucketID, title, description, scheduledDate, kind, strings.TrimSpace(assigneeAgentID), parentTaskID, overrideLimit})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func topLevelTaskCreateFingerprint(bucketID string, title string, description string, scheduledDate string, kind string, assigneeAgentID string, overrideLimit bool) (string, error) {
	raw, err := json.Marshal(struct {
		BucketID        string `json:"bucketId"`
		Title           string `json:"title"`
		Description     string `json:"description"`
		ScheduledDate   string `json:"scheduledDate"`
		Kind            string `json:"kind"`
		AssigneeAgentID string `json:"assigneeAgentId"`
		OverrideLimit   bool   `json:"overrideLimit"`
	}{bucketID, title, description, scheduledDate, kind, strings.TrimSpace(assigneeAgentID), overrideLimit})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func (s *Store) UpdateTask(ctx context.Context, userID string, id string, input UpdateTaskInput) (Task, error) {
	return s.updateTask(ctx, userID, "", id, input, false)
}

func (s *Store) UpdateTaskForHuman(ctx context.Context, userID string, id string, input UpdateTaskInput) (Task, error) {
	return s.updateTask(ctx, userID, "", id, input, true)
}

func (s *Store) UpdateTaskForAgent(ctx context.Context, userID string, agentID string, id string, input UpdateTaskInput) (Task, error) {
	if input.BucketID != nil || input.SortOrder != nil || input.AssigneeAgentID != nil {
		return Task{}, ErrAgentTaskScope
	}
	return s.updateTask(ctx, userID, agentID, id, input, false)
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
	// Moves can lock several task rows while list or board deletion locks the
	// same rows. Serialize them through the account-first quota lock used by
	// every deletion path before taking any task lock.
	if _, err := lockStorageQuota(ctx, tx, userID); err != nil {
		return Task{}, err
	}
	current, err := lockedTask(ctx, tx, userID, id)
	if err != nil {
		return Task{}, err
	}
	if current.ParentTaskID != "" {
		parent, err := lockedTask(ctx, tx, userID, current.ParentTaskID)
		if err != nil {
			return Task{}, err
		}
		if current.BucketID == parent.BucketID || parent.BucketID != bucketID {
			return Task{}, fmt.Errorf("%w: a subtask must stay in its parent list", ErrInvalidData)
		}
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
	childIDs, err := orderedChildTaskIDs(ctx, tx, current.ID)
	if err != nil {
		return Task{}, err
	}
	destinationIDs = removeTaskIDs(destinationIDs, childIDs)
	if *input.Position > len(destinationIDs) {
		return Task{}, fmt.Errorf("%w: position is outside the destination list", ErrInvalidData)
	}
	taskGroup := append([]string{current.ID}, childIDs...)
	destinationIDs = insertTaskIDs(destinationIDs, taskGroup, *input.Position)

	if current.BucketID != destination.ID {
		sourceIDs, err := orderedTaskIDs(ctx, tx, current.BucketID, current.ID)
		if err != nil {
			return Task{}, err
		}
		sourceIDs = removeTaskIDs(sourceIDs, childIDs)
		if err := updateTaskLocation(ctx, tx, current.ID, destination, *input.Position); err != nil {
			return Task{}, err
		}
		if err := updateChildTaskLocations(ctx, tx, current.ID, destination); err != nil {
			return Task{}, err
		}
		if err := writeTaskOrder(ctx, tx, sourceIDs); err != nil {
			return Task{}, err
		}
	} else if err := touchTask(ctx, tx, current.ID); err != nil {
		return Task{}, err
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

func orderedChildTaskIDs(ctx context.Context, tx pgx.Tx, parentTaskID string) ([]string, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text
		FROM tasks
		WHERE parent_task_id = $1
		ORDER BY sort_order, created_at
		FOR UPDATE
	`, parentTaskID)
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

func removeTaskIDs(ids []string, removed []string) []string {
	if len(removed) == 0 {
		return ids
	}
	removedSet := make(map[string]struct{}, len(removed))
	for _, id := range removed {
		removedSet[id] = struct{}{}
	}
	kept := ids[:0]
	for _, id := range ids {
		if _, remove := removedSet[id]; !remove {
			kept = append(kept, id)
		}
	}
	return kept
}

func insertTaskIDs(ids []string, inserted []string, position int) []string {
	result := make([]string, 0, len(ids)+len(inserted))
	result = append(result, ids[:position]...)
	result = append(result, inserted...)
	result = append(result, ids[position:]...)
	return result
}

func updateTaskLocation(ctx context.Context, tx pgx.Tx, taskID string, destination Bucket, position int) error {
	_, err := tx.Exec(ctx, `
		UPDATE tasks
		SET board_id = $2, bucket_id = $3, sort_order = $4, updated_at = now()
		WHERE id = $1
	`, taskID, destination.BoardID, destination.ID, position)
	return err
}

func updateChildTaskLocations(ctx context.Context, tx pgx.Tx, parentTaskID string, destination Bucket) error {
	_, err := tx.Exec(ctx, `
		UPDATE tasks
		SET board_id = $2, bucket_id = $3, updated_at = now()
		WHERE parent_task_id = $1
	`, parentTaskID, destination.BoardID, destination.ID)
	return err
}

func writeTaskOrder(ctx context.Context, tx pgx.Tx, ids []string) error {
	for position, id := range ids {
		if _, err := tx.Exec(ctx, "UPDATE tasks SET sort_order = $1 WHERE id = $2", position, id); err != nil {
			return err
		}
	}
	return nil
}

func touchTask(ctx context.Context, tx pgx.Tx, taskID string) error {
	_, err := tx.Exec(ctx, "UPDATE tasks SET updated_at = now() WHERE id = $1", taskID)
	return err
}

func (s *Store) updateTask(ctx context.Context, userID string, requiredAgentID string, id string, input UpdateTaskInput, allowWorking bool) (Task, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback(ctx)
	var quota *storageQuota
	if input.Title != nil || input.Description != nil || input.BucketID != nil {
		quota, err = lockStorageQuota(ctx, tx, userID)
		if err != nil {
			return Task{}, err
		}
	}
	current, err := lockedTaskForAgent(ctx, tx, userID, requiredAgentID, id)
	if err != nil {
		return Task{}, err
	}
	original := current
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
	moveChildren := false
	var sourceOrder []string
	var destinationOrder []string
	if input.BucketID != nil && *input.BucketID != current.BucketID {
		if input.SortOrder != nil {
			return Task{}, fmt.Errorf("%w: use the move endpoint to change a task list and position together", ErrInvalidData)
		}
		if current.ParentTaskID != "" {
			parent, err := lockedTask(ctx, tx, userID, current.ParentTaskID)
			if err != nil {
				return Task{}, err
			}
			if parent.BucketID != *input.BucketID {
				return Task{}, fmt.Errorf("%w: a subtask must stay in its parent list", ErrInvalidData)
			}
		}
		bucket, err := lockedBucket(ctx, tx, userID, *input.BucketID)
		if err != nil {
			return Task{}, err
		}
		destinationOrder, err = orderedTaskIDs(ctx, tx, bucket.ID, current.ID)
		if err != nil {
			return Task{}, err
		}
		childIDs, err := orderedChildTaskIDs(ctx, tx, current.ID)
		if err != nil {
			return Task{}, err
		}
		destinationOrder = removeTaskIDs(destinationOrder, childIDs)
		taskGroup := append([]string{current.ID}, childIDs...)
		destinationOrder = insertTaskIDs(destinationOrder, taskGroup, 0)
		sourceOrder, err = orderedTaskIDs(ctx, tx, current.BucketID, current.ID)
		if err != nil {
			return Task{}, err
		}
		sourceOrder = removeTaskIDs(sourceOrder, childIDs)
		current.BucketID = bucket.ID
		current.BoardID = bucket.BoardID
		current.SortOrder = 0
		moveChildren = current.ParentTaskID == ""
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
	if input.Priority != nil {
		priority := clean(*input.Priority)
		if !validPriority(priority) {
			return Task{}, fmt.Errorf("%w: invalid priority", ErrInvalidData)
		}
		current.Priority = priority
	}
	if input.SortOrder != nil {
		current.SortOrder = *input.SortOrder
	}
	if input.AssigneeAgentID != nil {
		current.AssigneeAgentID, err = activeAgentAssignment(ctx, tx, userID, *input.AssigneeAgentID)
		if err != nil {
			return Task{}, err
		}
	}
	if current.AssigneeAgentID != "" && !current.Done && (current.Status == StatusNew || current.Status == StatusQueued || current.Status == StatusWorking) {
		if _, err := activeAgentAssignment(ctx, tx, userID, current.AssigneeAgentID); err != nil {
			return Task{}, fmt.Errorf("%w: clear or replace the archived agent before moving this item to New, Ready, or In Progress", ErrInvalidData)
		}
	}
	if current.Title == "" {
		return Task{}, fmt.Errorf("%w: task title is required", ErrInvalidData)
	}
	contentDelta := taskContentBytes(current) - taskContentBytes(original)
	if quota != nil {
		if err := quota.apply(ctx, tx, 0, contentDelta); err != nil {
			return Task{}, err
		}
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
			done = $9, status = $10, priority = $11, sort_order = $12,
			assignee_agent_id = NULLIF($13, '')::uuid,
			review_reason = CASE
				WHEN $10 <> 'needs_review' THEN ''
				WHEN t.status <> 'needs_review' THEN ''
				ELSE t.review_reason
			END,
			updated_at = now()
		FROM boards b
		WHERE b.id = t.board_id AND b.user_id = $1 AND t.id = $2
		RETURNING t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind, t.done,
			t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
			COALESCE(t.assignee_agent_id::text, ''), COALESCE(t.parent_task_id::text, '')
	`, userID, id, current.BoardID, current.BucketID, current.Title, current.Description, current.ScheduledDate, current.Kind, current.Done,
		current.Status, current.Priority, current.SortOrder, current.AssigneeAgentID)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	if err != nil {
		return Task{}, err
	}
	if moveChildren {
		destination := Bucket{ID: task.BucketID, BoardID: task.BoardID}
		if err := updateChildTaskLocations(ctx, tx, task.ID, destination); err != nil {
			return Task{}, err
		}
	}
	if sourceOrder != nil {
		if err := writeTaskOrder(ctx, tx, sourceOrder); err != nil {
			return Task{}, err
		}
	}
	if destinationOrder != nil {
		if err := writeTaskOrder(ctx, tx, destinationOrder); err != nil {
			return Task{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Task{}, err
	}
	return task, nil
}

func (s *Store) ClaimTask(ctx context.Context, userID string, id string) (Task, error) {
	return s.claimTask(ctx, userID, "", id)
}

func (s *Store) ClaimTaskForAgent(ctx context.Context, userID string, agentID string, id string) (Task, error) {
	return s.claimTask(ctx, userID, agentID, id)
}

func (s *Store) claimTask(ctx context.Context, userID string, agentID string, id string) (Task, error) {
	agentSQL := ""
	args := []any{userID, id, StatusWorking, StatusQueued, KindAction}
	if agentID != "" {
		args = append(args, agentID)
		agentSQL = " AND t.assignee_agent_id = $6"
	}
	row := s.db.QueryRow(ctx, `
		UPDATE tasks t
		SET status = $3, review_reason = '', updated_at = now()
		FROM boards b
		WHERE b.id = t.board_id
			AND b.user_id = $1
			AND t.id = $2
			AND t.done = false
			AND t.kind = $5
			AND t.status = $4
			`+agentSQL+`
		RETURNING t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind, t.done,
			t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
			COALESCE(t.assignee_agent_id::text, ''), COALESCE(t.parent_task_id::text, '')
	`, args...)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrTaskUnavailable
	}
	return task, err
}

func (s *Store) DeleteTask(ctx context.Context, userID string, id string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	quota, err := lockStorageQuota(ctx, tx, userID)
	if err != nil {
		return err
	}
	task, err := lockedTask(ctx, tx, userID, id)
	if err != nil {
		return err
	}
	usage, err := lockedTaskStorage(ctx, tx, `
		SELECT t.storage_bytes + COALESCE((
			SELECT sum(octet_length(entry.body))
			FROM card_entries entry
			WHERE entry.task_id = t.id
		), 0)
		FROM tasks t
		WHERE t.id = $1 OR t.parent_task_id = $1
		FOR UPDATE OF t
	`, task.ID)
	if err != nil {
		return err
	}
	if err := quota.apply(ctx, tx, -usage.Tasks, -usage.ContentBytes); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, "DELETE FROM tasks WHERE id = $1", task.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return tx.Commit(ctx)
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
	if _, err := lockStorageQuota(ctx, tx, userID); err != nil {
		return err
	}
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
	return s.getTask(ctx, userID, "", id)
}

func (s *Store) GetTaskForAgent(ctx context.Context, userID string, agentID string, id string) (Task, error) {
	return s.getTask(ctx, userID, agentID, id)
}

func (s *Store) ListCardEntries(ctx context.Context, userID string, agentID string, taskID string) ([]CardEntry, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	args := []any{userID, taskID}
	agentSQL := ""
	if agentID != "" {
		args = append(args, agentID)
		agentSQL = " AND t.assignee_agent_id = $3"
	}
	var authorizedTaskID string
	if err := tx.QueryRow(ctx, `
		SELECT t.id::text
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		WHERE b.user_id = $1 AND t.id = $2`+agentSQL+`
		FOR SHARE OF t
	`, args...).Scan(&authorizedTaskID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	rows, err := tx.Query(ctx, `
		SELECT id::text, task_id::text, kind, body,
			author_kind, author_id::text, author_name, created_at
		FROM card_entries
		WHERE task_id = $1
		ORDER BY created_at, id
	`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []CardEntry{}
	for rows.Next() {
		var entry CardEntry
		if err := rows.Scan(&entry.ID, &entry.TaskID, &entry.Kind, &entry.Body,
			&entry.AuthorKind, &entry.AuthorID, &entry.AuthorName, &entry.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return entries, nil
}

func (s *Store) ListCardReviewKinds(ctx context.Context, userID string, agentID string) (map[string]string, error) {
	args := []any{userID, StatusNeedsReview}
	agentSQL := ""
	if agentID != "" {
		args = append(args, agentID)
		agentSQL = " AND t.assignee_agent_id = $3"
	}
	rows, err := s.db.Query(ctx, `
		SELECT t.id::text, COALESCE(NULLIF(t.review_reason, ''), 'other')
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		WHERE b.user_id = $1 AND t.status = $2`+agentSQL+`
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	kinds := map[string]string{}
	for rows.Next() {
		var taskID, kind string
		if err := rows.Scan(&taskID, &kind); err != nil {
			return nil, err
		}
		kinds[taskID] = kind
	}
	return kinds, rows.Err()
}

func (s *Store) CreateCardEntry(ctx context.Context, userID string, agentID string, authorName string, taskID string, input CreateCardEntryInput) (CardEntry, error) {
	body := strings.TrimSpace(input.Body)
	kind := strings.TrimSpace(input.Kind)
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if body == "" {
		return CardEntry{}, fmt.Errorf("%w: entry body is required", ErrInvalidData)
	}
	if kind != "comment" && kind != "output" {
		return CardEntry{}, fmt.Errorf("%w: entry kind must be comment or output", ErrInvalidData)
	}
	if len([]byte(body)) > httpapi.CardEntryBytes {
		return CardEntry{}, fmt.Errorf("%w: entry body must be %d UTF-8 bytes or fewer", ErrInvalidData, httpapi.CardEntryBytes)
	}
	if len([]byte(idempotencyKey)) > httpapi.TaskIdempotencyBytes {
		return CardEntry{}, fmt.Errorf("%w: idempotency key must be %d UTF-8 bytes or fewer", ErrInvalidData, httpapi.TaskIdempotencyBytes)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return CardEntry{}, err
	}
	defer tx.Rollback(ctx)
	quota, err := lockStorageQuota(ctx, tx, userID)
	if err != nil {
		return CardEntry{}, err
	}
	args := []any{userID, taskID}
	agentSQL := ""
	if agentID != "" {
		args = append(args, agentID)
		agentSQL = " AND t.assignee_agent_id = $3"
	}
	var authorizedTaskID, cardStatus, cardReviewReason string
	var cardDone bool
	if err := tx.QueryRow(ctx, `
		SELECT t.id::text, t.status, t.done, COALESCE(t.review_reason, '')
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		WHERE b.user_id = $1 AND t.id = $2`+agentSQL+`
		FOR UPDATE OF t
	`, args...).Scan(&authorizedTaskID, &cardStatus, &cardDone, &cardReviewReason); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return CardEntry{}, ErrNotFound
		}
		return CardEntry{}, err
	}
	authorKind := "human"
	authorID := userID
	if agentID != "" {
		authorKind = "agent"
		authorID = agentID
		if err := tx.QueryRow(ctx, `
			SELECT name FROM agents
			WHERE id = $1 AND owner_user_id = $2 AND archived_at IS NULL
		`, agentID, userID).Scan(&authorName); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return CardEntry{}, ErrNotFound
			}
			return CardEntry{}, err
		}
	}
	authorName = strings.TrimSpace(authorName)
	if authorName == "" {
		authorName = "You"
	}
	fingerprint, err := cardEntryFingerprint(kind, body)
	if err != nil {
		return CardEntry{}, err
	}
	if idempotencyKey != "" {
		lockKey := strings.Join([]string{userID, "card-entry", taskID, authorKind, authorID, idempotencyKey}, ":")
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", lockKey); err != nil {
			return CardEntry{}, err
		}
		var existing CardEntry
		var existingFingerprint string
		err := tx.QueryRow(ctx, `
			SELECT id::text, task_id::text, kind, body,
				author_kind, author_id::text, author_name, created_at, request_hash
			FROM card_entries
			WHERE task_id = $1 AND author_kind = $2 AND author_id = $3 AND idempotency_key = $4
		`, taskID, authorKind, authorID, idempotencyKey).Scan(
			&existing.ID, &existing.TaskID, &existing.Kind, &existing.Body,
			&existing.AuthorKind, &existing.AuthorID, &existing.AuthorName, &existing.CreatedAt, &existingFingerprint,
		)
		if err == nil {
			if existingFingerprint != fingerprint {
				return CardEntry{}, ErrIdempotencyKey
			}
			existing.CardStatus = cardStatus
			existing.CardDone = cardDone
			existing.CardReviewReason = cardReviewReason
			return existing, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return CardEntry{}, err
		}
	}
	var entryCount int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM card_entries WHERE task_id = $1", taskID).Scan(&entryCount); err != nil {
		return CardEntry{}, err
	}
	if entryCount >= MaxCardEntries {
		return CardEntry{}, fmt.Errorf("%w: cards can contain at most %d conversation entries", ErrInvalidData, MaxCardEntries)
	}
	var entry CardEntry
	err = tx.QueryRow(ctx, `
		INSERT INTO card_entries (task_id, kind, body, author_kind, author_id, author_name, idempotency_key, request_hash)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8)
		RETURNING id::text, task_id::text, kind, body,
			author_kind, author_id::text, author_name, created_at
	`, taskID, kind, body, authorKind, authorID, authorName, idempotencyKey, fingerprint).Scan(
		&entry.ID, &entry.TaskID, &entry.Kind, &entry.Body,
		&entry.AuthorKind, &entry.AuthorID, &entry.AuthorName, &entry.CreatedAt,
	)
	if err != nil {
		return CardEntry{}, err
	}
	if err := quota.apply(ctx, tx, 0, int64(len([]byte(body)))); err != nil {
		return CardEntry{}, err
	}
	if kind == "output" {
		if _, err := tx.Exec(ctx, `
			UPDATE tasks
			SET status = $1, done = false, review_reason = 'output', updated_at = now()
			WHERE id = $2
		`, StatusNeedsReview, taskID); err != nil {
			return CardEntry{}, err
		}
		cardStatus = StatusNeedsReview
		cardDone = false
		cardReviewReason = "output"
	}
	entry.CardStatus = cardStatus
	entry.CardDone = cardDone
	entry.CardReviewReason = cardReviewReason
	if err := tx.Commit(ctx); err != nil {
		return CardEntry{}, err
	}
	return entry, nil
}

func cardEntryFingerprint(kind string, body string) (string, error) {
	raw, err := json.Marshal(struct {
		Kind string `json:"kind"`
		Body string `json:"body"`
	}{kind, body})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func (s *Store) getTask(ctx context.Context, userID string, agentID string, id string) (Task, error) {
	agentSQL := ""
	args := []any{userID, id}
	if agentID != "" {
		args = append(args, agentID)
		agentSQL = " AND t.assignee_agent_id = $3"
	}
	row := s.db.QueryRow(ctx, `
		SELECT t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind, t.done,
			t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
			COALESCE(t.assignee_agent_id::text, ''), COALESCE(t.parent_task_id::text, '')
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		WHERE b.user_id = $1 AND t.id = $2
			`+agentSQL+`
	`, args...)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	return task, err
}

func (s *Store) ListTasks(ctx context.Context, userID string, filter TaskFilter) ([]Task, error) {
	page, err := s.ListTaskPage(ctx, userID, filter)
	return page.Tasks, err
}

func (s *Store) ListTaskPage(ctx context.Context, userID string, filter TaskFilter) (TaskPage, error) {
	if err := validateTaskFilterLocationIDs(filter); err != nil {
		return TaskPage{}, fmt.Errorf("%w: %v", ErrInvalidData, err)
	}
	whereSQL := ""
	args := []any{userID}
	if filter.BoardID != "" {
		args = append(args, filter.BoardID)
		whereSQL += fmt.Sprintf(" AND t.board_id = $%d", len(args))
	}
	if filter.BucketID != "" {
		args = append(args, filter.BucketID)
		whereSQL += fmt.Sprintf(" AND t.bucket_id = $%d", len(args))
	}
	if filter.Status != "" {
		args = append(args, filter.Status)
		whereSQL += fmt.Sprintf(" AND t.status = $%d", len(args))
	}
	if filter.Priority != "" {
		args = append(args, filter.Priority)
		whereSQL += fmt.Sprintf(" AND t.priority = $%d", len(args))
	}
	if filter.Done != nil {
		args = append(args, *filter.Done)
		whereSQL += fmt.Sprintf(" AND t.done = $%d", len(args))
	}
	if filter.ActionsOnly {
		args = append(args, KindAction)
		whereSQL += fmt.Sprintf(" AND t.kind = $%d", len(args))
	}
	if filter.AssigneeAgentID != "" {
		args = append(args, filter.AssigneeAgentID)
		whereSQL += fmt.Sprintf(" AND t.assignee_agent_id = $%d", len(args))
	}
	if filter.Unassigned {
		whereSQL += " AND t.assignee_agent_id IS NULL"
	}
	if filter.Query != "" {
		args = append(args, taskSearchPattern(filter.Query))
		whereSQL += fmt.Sprintf(" AND (t.title ILIKE $%d ESCAPE E'\\\\' OR t.description ILIKE $%d ESCAPE E'\\\\')", len(args), len(args))
	}
	if filter.ScheduledFrom != "" {
		args = append(args, filter.ScheduledFrom)
		whereSQL += fmt.Sprintf(" AND t.scheduled_date >= $%d::date", len(args))
	}
	if filter.ScheduledTo != "" {
		args = append(args, filter.ScheduledTo)
		whereSQL += fmt.Sprintf(" AND t.scheduled_date <= $%d::date", len(args))
	}
	if filter.ParentTaskID != "" {
		args = append(args, filter.ParentTaskID)
		whereSQL += fmt.Sprintf(" AND t.parent_task_id = $%d", len(args))
	} else if filter.TopLevelOnly {
		whereSQL += " AND t.parent_task_id IS NULL"
	}
	if filter.InboxOnly {
		whereSQL += " AND l.is_inbox = true"
	}
	completedHistory := filter.Done != nil && *filter.Done
	limit := filter.Limit
	if completedHistory {
		if limit <= 0 {
			limit = defaultCompletedHistoryLimit
		}
		if limit > maxCompletedHistoryLimit {
			limit = maxCompletedHistoryLimit
		}
	} else if limit <= 0 || limit > 200 {
		limit = 100
	}
	orderSQL := "t.created_at DESC, t.id DESC"
	if completedHistory {
		orderSQL = "t.updated_at DESC, t.id DESC"
	}
	if filter.Cursor != "" {
		cursor, err := decodeCompletedTaskCursor(filter.Cursor, taskCursorScope(userID, filter))
		if err != nil {
			return TaskPage{}, err
		}
		args = append(args, cursor.UpdatedAt, cursor.ID)
		column := "t.created_at"
		if completedHistory {
			column = "t.updated_at"
		}
		whereSQL += fmt.Sprintf(" AND (%s < $%d OR (%s = $%d AND t.id < $%d::uuid))", column, len(args)-1, column, len(args)-1, len(args))
	}
	fetchLimit := limit + 1
	args = append(args, fetchLimit)
	query := `
		SELECT t.id::text, t.board_id::text, t.bucket_id::text, t.title, '',
			COALESCE(t.scheduled_date::text, ''), t.kind, t.done,
			t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
			COALESCE(t.assignee_agent_id::text, ''), COALESCE(t.parent_task_id::text, ''),
			l.name, b.name, COALESCE(a.name, ''), COALESCE(parent.title, '')
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		JOIN buckets l ON l.id = t.bucket_id
		LEFT JOIN agents a ON a.id = t.assignee_agent_id
		LEFT JOIN tasks parent ON parent.id = t.parent_task_id
			AND parent.board_id = t.board_id AND parent.bucket_id = t.bucket_id
		WHERE b.user_id = $1` + whereSQL + `
		ORDER BY ` + orderSQL + `
		LIMIT $` + fmt.Sprint(len(args))
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return TaskPage{}, err
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		task, err := scanTaskSummary(rows)
		if err != nil {
			return TaskPage{}, err
		}
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		return TaskPage{}, err
	}
	page := TaskPage{Tasks: tasks}
	if page.Tasks == nil {
		page.Tasks = []Task{}
	}
	if len(page.Tasks) > limit {
		page.Tasks = page.Tasks[:limit]
		cursorTask := page.Tasks[len(page.Tasks)-1]
		if !completedHistory {
			cursorTask.UpdatedAt = cursorTask.CreatedAt
		}
		page.NextCursor, err = encodeCompletedTaskCursor(cursorTask, taskCursorScope(userID, filter))
		if err != nil {
			return TaskPage{}, err
		}
	}
	return page, nil
}

func taskSearchPattern(query string) string {
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(query)
	return "%" + escaped + "%"
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

func (s *Store) listBucketsForAgent(ctx context.Context, userID string, agentID string, boardID string) ([]Bucket, error) {
	rows, err := s.db.Query(ctx, `
		SELECT b.id::text, b.board_id::text, b.name, b.goal, b.is_inbox, bo.max_tasks_per_list, b.sort_order,
			COUNT(t.id) FILTER (WHERE t.kind = 'action' AND t.done = false)::int AS open_count,
			b.created_at, b.updated_at
		FROM buckets b
		JOIN boards bo ON bo.id = b.board_id
		JOIN tasks t ON t.board_id = b.board_id AND t.bucket_id = b.id AND t.assignee_agent_id = $3
		WHERE bo.user_id = $1 AND b.board_id = $2
		GROUP BY b.id, bo.max_tasks_per_list
		ORDER BY b.sort_order, b.created_at
	`, userID, boardID, agentID)
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
	return lockedTaskForAgent(ctx, tx, userID, "", id)
}

func lockedTaskForAgent(ctx context.Context, tx pgx.Tx, userID string, agentID string, id string) (Task, error) {
	agentSQL := ""
	args := []any{userID, id}
	if agentID != "" {
		args = append(args, agentID)
		agentSQL = " AND t.assignee_agent_id = $3"
	}
	row := tx.QueryRow(ctx, `
		SELECT t.id::text, t.board_id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind, t.done,
			t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
			COALESCE(t.assignee_agent_id::text, ''), COALESCE(t.parent_task_id::text, '')
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		WHERE b.user_id = $1 AND t.id = $2
			`+agentSQL+`
		FOR UPDATE OF t
	`, args...)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	return task, err
}

func checkTaskCapacity(ctx context.Context, tx pgx.Tx, bucket Bucket, exceptTaskID string, overrideWorkingLimit bool) error {
	// Lists organise work. They do not reject new work. Account-level task and
	// content quotas remain the storage boundary.
	return nil
}

func (s *Store) listBucketTasks(ctx context.Context, userID string, bucketID string) ([]Task, string, error) {
	rows, err := s.db.Query(ctx, `
		WITH active AS (
			SELECT t.id, t.board_id, t.bucket_id, t.title, COALESCE(t.scheduled_date::text, '') AS scheduled_date,
				t.kind, t.done, t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
				COALESCE(t.assignee_agent_id::text, '') AS assignee_agent_id,
				COALESCE(t.parent_task_id::text, '') AS parent_task_id, false AS completed_history
			FROM tasks t
			JOIN boards b ON b.id = t.board_id
			WHERE b.user_id = $1 AND t.bucket_id = $2 AND t.done = false
		), completed AS (
			SELECT t.id, t.board_id, t.bucket_id, t.title, COALESCE(t.scheduled_date::text, '') AS scheduled_date,
				t.kind, t.done, t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
				COALESCE(t.assignee_agent_id::text, '') AS assignee_agent_id,
				COALESCE(t.parent_task_id::text, '') AS parent_task_id, true AS completed_history
			FROM tasks t
			JOIN boards b ON b.id = t.board_id
			WHERE b.user_id = $1 AND t.bucket_id = $2 AND t.done = true
			ORDER BY t.updated_at DESC, t.id DESC
			LIMIT 21
		), selected AS (
			SELECT * FROM active
			UNION ALL
			SELECT * FROM completed
		)
		SELECT id::text, board_id::text, bucket_id::text, title, '', scheduled_date, kind, done,
			status, priority, sort_order, created_at, updated_at, assignee_agent_id, parent_task_id, completed_history
		FROM selected
		ORDER BY completed_history,
			CASE WHEN completed_history = false THEN sort_order END,
			CASE WHEN completed_history = false THEN created_at END,
			CASE WHEN completed_history = true THEN updated_at END DESC,
			CASE WHEN completed_history = true THEN id END DESC
	`, userID, bucketID)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	var tasks []Task
	var completed []Task
	for rows.Next() {
		task, isCompletedHistory, err := scanTaskCollection(rows)
		if err != nil {
			return nil, "", err
		}
		if isCompletedHistory {
			completed = append(completed, task)
			continue
		}
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	nextCursor := ""
	if len(completed) > defaultCompletedHistoryLimit {
		completed = completed[:defaultCompletedHistoryLimit]
		done := true
		cursor, err := encodeCompletedTaskCursor(completed[len(completed)-1], taskCursorScope(userID, TaskFilter{BucketID: bucketID, Done: &done}))
		if err != nil {
			return nil, "", err
		}
		nextCursor = cursor
	}
	tasks = append(tasks, completed...)
	return tasks, nextCursor, nil
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
	err := row.Scan(taskScanDestinations(&task)...)
	return task, err
}

func scanTaskSummary(row rowScanner) (Task, error) {
	var task Task
	destinations := append(taskScanDestinations(&task), &task.BucketName, &task.BoardName, &task.AssigneeAgentName, &task.ParentTaskTitle)
	err := row.Scan(destinations...)
	return task, err
}

func scanTaskCollection(row rowScanner) (Task, bool, error) {
	var task Task
	var completedHistory bool
	destinations := append(taskScanDestinations(&task), &completedHistory)
	err := row.Scan(destinations...)
	return task, completedHistory, err
}

func taskScanDestinations(task *Task) []any {
	return []any{
		&task.ID, &task.BoardID, &task.BucketID, &task.Title, &task.Description, &task.ScheduledDate, &task.Kind, &task.Done,
		&task.Status, &task.Priority,
		&task.SortOrder, &task.CreatedAt, &task.UpdatedAt,
		&task.AssigneeAgentID,
		&task.ParentTaskID,
	}
}

func taskCursorScope(userID string, filter TaskFilter) string {
	done := ""
	if filter.Done != nil {
		done = fmt.Sprint(*filter.Done)
	}
	value := strings.Join([]string{
		userID, filter.BoardID, filter.BucketID, filter.Status, filter.Priority,
		done, fmt.Sprint(filter.ActionsOnly), filter.AssigneeAgentID, fmt.Sprint(filter.Unassigned),
		filter.Query, filter.ScheduledFrom, filter.ScheduledTo, filter.ParentTaskID, fmt.Sprint(filter.TopLevelOnly),
		fmt.Sprint(filter.InboxOnly),
	}, "\x00")
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func encodeCompletedTaskCursor(task Task, scope string) (string, error) {
	encoded, err := json.Marshal(completedTaskCursor{UpdatedAt: task.UpdatedAt.UTC(), ID: task.ID, Scope: scope})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func decodeCompletedTaskCursor(raw string, scope string) (completedTaskCursor, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return completedTaskCursor{}, fmt.Errorf("%w: invalid completed-task cursor", ErrInvalidData)
	}
	var cursor completedTaskCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.UpdatedAt.IsZero() || !validUUIDText(cursor.ID) || cursor.Scope != scope {
		return completedTaskCursor{}, fmt.Errorf("%w: invalid completed-task cursor", ErrInvalidData)
	}
	return cursor, nil
}

func validUUIDText(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	compact := value[:8] + value[9:13] + value[14:18] + value[19:23] + value[24:]
	_, err := hex.DecodeString(compact)
	return err == nil
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

func accountLimitsForUpdate(ctx context.Context, tx pgx.Tx, userID string) (entitlements.Limits, error) {
	var role, plan, source string
	err := tx.QueryRow(ctx, `
		SELECT u.role, COALESCE(e.plan, ''), COALESCE(e.source, '')
		FROM users u
		LEFT JOIN entitlements e ON e.user_id = u.id
		WHERE u.id = $1 AND u.disabled_at IS NULL
		FOR UPDATE OF u
	`, userID).Scan(&role, &plan, &source)
	if errors.Is(err, pgx.ErrNoRows) {
		return entitlements.Limits{}, ErrNotFound
	}
	if err != nil {
		return entitlements.Limits{}, err
	}
	return entitlements.Resolve(role, plan, source).Limits, nil
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
	case StatusNew, StatusQueued, StatusWorking, StatusNeedsReview, StatusDone:
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

func validPriority(priority string) bool {
	switch priority {
	case PriorityNone, PriorityP0, PriorityP1, PriorityP2:
		return true
	}
	return false
}
