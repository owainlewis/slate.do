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
	ErrNotFound               = errors.New("not found")
	ErrLimitFull              = errors.New("working limit reached")
	ErrListLimit              = errors.New("list limit reached")
	ErrActiveItemLimit        = errors.New("active item limit reached")
	ErrInvalidData            = errors.New("invalid data")
	ErrTaskUnavailable        = errors.New("task is not available")
	ErrIdempotencyKey         = errors.New("idempotency key already used with different data")
	ErrIdempotencyGone        = errors.New("task created by idempotency key was deleted")
	ErrAgentTaskScope         = errors.New("agent credentials cannot move, reorder, or reassign tasks")
	ErrManagedRunMismatch     = errors.New("managed run does not own this task")
	ErrManagedRunStatusLocked = errors.New("managed run status is controlled by output")
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

type agentQueueCursor struct {
	PriorityRank int       `json:"priorityRank"`
	CreatedAt    time.Time `json:"createdAt"`
	ID           string    `json:"id"`
	Scope        string    `json:"scope"`
}

var (
	defaultMaxLists        = entitlements.ProLimits.Lists
	defaultMaxTasksPerList = entitlements.ProLimits.ActiveItemsPerList
)

type Store struct {
	db *database.Pool
}

func NewStore(db *database.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) SeedDefaultLists(ctx context.Context, userID string) error {
	var count int
	if err := s.db.QueryRow(ctx, "SELECT count(*) FROM buckets WHERE user_id = $1", userID).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	for _, bucket := range defaultBuckets() {
		if _, err := s.CreateBucket(ctx, userID, bucket); err != nil {
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

func (s *Store) ListAllBuckets(ctx context.Context, userID string) ([]Bucket, error) {
	rows, err := s.db.Query(ctx, `
		SELECT l.id::text, l.name, l.goal, l.is_inbox, l.limit_count, l.sort_order,
			COUNT(t.id) FILTER (WHERE t.kind = 'action' AND t.status <> 'done' AND t.parent_task_id IS NULL)::int AS open_count,
			l.created_at, l.updated_at
		FROM buckets l
		LEFT JOIN tasks t ON t.bucket_id = l.id
		WHERE l.user_id = $1
		GROUP BY l.id
		ORDER BY l.sort_order, l.created_at
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var lists []Bucket
	for rows.Next() {
		var list Bucket
		if err := rows.Scan(
			&list.ID, &list.Name, &list.Goal, &list.IsInbox, &list.LimitCount,
			&list.SortOrder, &list.OpenCount, &list.CreatedAt, &list.UpdatedAt,
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
		SELECT id::text
		FROM buckets
		WHERE user_id = $1 AND is_inbox = true
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
		SELECT id::text
		FROM buckets
		WHERE user_id = $1 AND is_inbox = true
		FOR UPDATE
	`, userID).Scan(&inboxID)
	if err == nil {
		return inboxID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	var firstListID string
	err = tx.QueryRow(ctx, `
		SELECT id::text
		FROM buckets
		WHERE user_id = $1
		ORDER BY sort_order, created_at, id
		LIMIT 1
		FOR UPDATE
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

	err = tx.QueryRow(ctx, `
		INSERT INTO buckets (user_id, name, goal, is_inbox, limit_count, sort_order)
		VALUES ($1, 'Inbox', 'Capture now, organise later', true, $2, 0)
		RETURNING id::text
	`, userID, defaultMaxTasksPerList).Scan(&inboxID)
	if err != nil {
		return "", err
	}
	return inboxID, nil
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
		SELECT b.id::text, b.name, b.goal, b.is_inbox, b.limit_count, b.sort_order,
			COUNT(t.id) FILTER (WHERE t.kind = 'action' AND t.status <> 'done' AND t.parent_task_id IS NULL)::int AS open_count,
			b.created_at, b.updated_at
		FROM buckets b
		JOIN tasks t ON t.bucket_id = b.id AND t.assignee_agent_id = $3
		WHERE b.user_id = $1 AND b.id = $2
		GROUP BY b.id
	`, userID, id, agentID)
	bucket, err := scanBucket(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Bucket{}, ErrNotFound
	}
	return bucket, err
}

func (s *Store) CreateBucket(ctx context.Context, userID string, input CreateBucketInput) (Bucket, error) {
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
	var lockedUserID string
	if err := tx.QueryRow(ctx, `
		SELECT id::text
		FROM users
		WHERE id = $1 AND disabled_at IS NULL
		FOR UPDATE
	`, userID).Scan(&lockedUserID); errors.Is(err, pgx.ErrNoRows) {
		return Bucket{}, ErrNotFound
	} else if err != nil {
		return Bucket{}, err
	}
	var listCount int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM buckets WHERE user_id = $1", userID).Scan(&listCount); err != nil {
		return Bucket{}, err
	}
	if listCount >= limits.Lists {
		return Bucket{}, ErrListLimit
	}
	if input.IsInbox {
		if err := releaseInboxMarker(ctx, tx, userID, ""); err != nil {
			return Bucket{}, err
		}
	}
	var bucket Bucket
	err = tx.QueryRow(ctx, `
		INSERT INTO buckets (user_id, name, goal, is_inbox, limit_count, sort_order)
		VALUES (
			$1, $2, $3, $4, $5,
			COALESCE((SELECT max(sort_order) + 1 FROM buckets WHERE user_id = $1), 0)
		)
		RETURNING id::text, name, goal, is_inbox, limit_count, sort_order, created_at, updated_at
	`, userID, name, input.Goal, input.IsInbox, limit).Scan(
		&bucket.ID, &bucket.Name, &bucket.Goal, &bucket.IsInbox, &bucket.LimitCount,
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
		if err := ensureInboxSurvives(ctx, tx, userID, current.ID); err != nil {
			return Bucket{}, err
		}
	}
	if !wasInbox && current.IsInbox {
		if err := releaseInboxMarker(ctx, tx, userID, current.ID); err != nil {
			return Bucket{}, err
		}
	}
	var bucket Bucket
	err = tx.QueryRow(ctx, `
		UPDATE buckets b
		SET name = $3, goal = $4, limit_count = $5, is_inbox = $6, sort_order = $7, updated_at = now()
		WHERE b.user_id = $1 AND b.id = $2
		RETURNING b.id::text, b.name, b.goal, b.is_inbox, b.limit_count, b.sort_order, b.created_at, b.updated_at
	`, userID, id, current.Name, current.Goal, current.LimitCount, current.IsInbox, current.SortOrder).Scan(
		&bucket.ID, &bucket.Name, &bucket.Goal, &bucket.IsInbox, &bucket.LimitCount,
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
		SELECT id::text, is_inbox
		FROM buckets
		WHERE user_id = $1 AND id = $2
		FOR UPDATE
	`, userID, id).Scan(&bucketID, &isInbox); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if isInbox {
		if err := ensureInboxSurvives(ctx, tx, userID, bucketID); err != nil {
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

// releaseInboxMarker moves the Inbox marker to whichever list is taking it. An
// account has exactly one Inbox, so naming a new one is a move rather than an
// addition, and doing it in the same transaction keeps the uniqueness index
// satisfied at every statement boundary.
func releaseInboxMarker(ctx context.Context, tx pgx.Tx, userID string, exceptBucketID string) error {
	_, err := tx.Exec(ctx, `
		UPDATE buckets
		SET is_inbox = false, updated_at = now()
		WHERE user_id = $1 AND is_inbox AND ($2 = '' OR id <> $2::uuid)
	`, userID, exceptBucketID)
	return err
}

func ensureInboxSurvives(ctx context.Context, tx pgx.Tx, userID string, excludedBucketID string) error {
	var survives bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM buckets
			WHERE user_id = $1
				AND is_inbox = true
				AND ($2 = '' OR id <> $2::uuid)
		)
	`, userID, excludedBucketID).Scan(&survives)
	if err != nil {
		return err
	}
	if !survives {
		return fmt.Errorf("%w: the account must keep an Inbox list", ErrInvalidData)
	}
	return nil
}

func (s *Store) ReorderBuckets(ctx context.Context, userID string, ids []string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for i, id := range ids {
		tag, err := tx.Exec(ctx, "UPDATE buckets SET sort_order = $1, updated_at = now() WHERE user_id = $2 AND id = $3", i, userID, id)
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
	status                 string
	priority               string
	assigneeAgentID        string
	parentTaskID           string
	idempotencyKey         string
	fingerprint            string
	requestData            string
	legacyRequestData      string
	compatibleFingerprints []string
	strictRequestData      bool
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
	status := clean(input.Status)
	if status != "" && !validStatus(status) {
		return preparedTaskCreate{}, fmt.Errorf("%w: invalid task status", ErrInvalidData)
	}
	priority := clean(input.Priority)
	if !validPriority(priority) {
		return preparedTaskCreate{}, fmt.Errorf("%w: invalid priority", ErrInvalidData)
	}
	parentTaskID := clean(input.ParentTaskID)
	if parentTaskID != "" && !validUUID(parentTaskID) {
		return preparedTaskCreate{}, fmt.Errorf("%w: parentTaskId must be a valid ID", ErrInvalidData)
	}
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if len(idempotencyKey) > httpapi.TaskIdempotencyBytes {
		return preparedTaskCreate{}, fmt.Errorf("%w: idempotency key must be %d UTF-8 bytes or fewer", ErrInvalidData, httpapi.TaskIdempotencyBytes)
	}
	prepared := preparedTaskCreate{
		title: title, description: input.Description, scheduledDate: scheduledDate, kind: kind, status: status, priority: priority,
		assigneeAgentID: input.AssigneeAgentID, parentTaskID: parentTaskID,
		idempotencyKey: idempotencyKey, strictRequestData: status != "" || priority != "", overrideLimit: input.OverrideLimit,
	}
	if idempotencyKey != "" {
		requestData, err := taskCreateRequestDataV2(title, input.Description, scheduledDate, kind, status, priority, input.AssigneeAgentID, parentTaskID)
		if err != nil {
			return preparedTaskCreate{}, err
		}
		prepared.requestData = requestData
		legacyRequestData, err := taskCreateRequestData(title, input.Description, scheduledDate, kind, input.AssigneeAgentID, parentTaskID)
		if err != nil {
			return preparedTaskCreate{}, err
		}
		prepared.legacyRequestData = legacyRequestData
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
	if !validUUID(parentTaskID) {
		return Task{}, fmt.Errorf("%w: parent task ID must be a valid ID", ErrInvalidData)
	}
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
						WHERE b.user_id = $1
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
		var existingFingerprint, existingTaskID, existingParentTaskID string
		var requestDataMatches, legacyRequestDataMatches, legacyRequestUnknown bool
		err := tx.QueryRow(ctx, `
			SELECT key.request_hash, COALESCE(key.task_id::text, ''),
				COALESCE(key.request_data_hash = encode(sha256(convert_to(($3::jsonb)::text, 'UTF8')), 'hex'), false),
				COALESCE(key.request_data_hash = encode(sha256(convert_to(($4::jsonb)::text, 'UTF8')), 'hex'), false),
				key.request_data_hash IS NULL,
				COALESCE(task.parent_task_id::text, '')
			FROM task_idempotency_keys key
			LEFT JOIN tasks task ON task.id = key.task_id
			WHERE key.user_id = $1 AND key.key = $2
		`, userID, input.idempotencyKey, input.requestData, input.legacyRequestData).Scan(
			&existingFingerprint,
			&existingTaskID,
			&requestDataMatches,
			&legacyRequestDataMatches,
			&legacyRequestUnknown,
			&existingParentTaskID,
		)
		if err == nil {
			if !input.strictRequestData {
				requestDataMatches = requestDataMatches || legacyRequestDataMatches
			}
			fingerprintMatches := existingFingerprint == input.fingerprint
			for _, compatibleFingerprint := range input.compatibleFingerprints {
				if existingFingerprint == compatibleFingerprint {
					fingerprintMatches = true
					break
				}
			}
			if input.strictRequestData && !requestDataMatches {
				fingerprintMatches = false
			}
			requestDataFallback := input.parentTaskID != "" && existingTaskID != "" && requestDataMatches
			// Pre-migration keys did not retain the original request body. A
			// child retry may still return its original result when the stable
			// parent relationship matches. Never derive identity from fields on
			// the mutable task row.
			legacyParentFallback := !input.strictRequestData && input.parentTaskID != "" &&
				existingTaskID != "" &&
				legacyRequestUnknown &&
				existingParentTaskID == input.parentTaskID
			if !fingerprintMatches && !requestDataFallback && !legacyParentFallback {
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
		bucketID = parent.BucketID
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
	task, err := insertTask(ctx, tx, bucket, input.title, input.description, input.scheduledDate, input.kind, input.status, input.priority, assigneeAgentID, input.parentTaskID)
	if err != nil {
		return Task{}, err
	}
	if input.idempotencyKey != "" {
		if _, err := tx.Exec(ctx, `
			INSERT INTO task_idempotency_keys (user_id, key, request_hash, task_id, request_data_hash)
			VALUES ($1, $2, $3, $4, encode(sha256(convert_to(($5::jsonb)::text, 'UTF8')), 'hex'))
		`, userID, input.idempotencyKey, input.fingerprint, task.ID, input.requestData); err != nil {
			return Task{}, err
		}
	}
	return task, nil
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

func insertTask(ctx context.Context, db queryRower, bucket Bucket, title string, description string, scheduledDate string, kind string, status string, priority string, assigneeAgentID string, parentTaskID string) (Task, error) {
	if status == "" {
		status = StatusNew
	}
	if assigneeAgentID != "" && status == StatusNew {
		status = StatusQueued
	}
	row := db.QueryRow(ctx, `
		INSERT INTO tasks (bucket_id, title, description, scheduled_date, kind, status, priority, assignee_agent_id, parent_task_id, sort_order)
		VALUES (
			$1, $2, $3, NULLIF($4, '')::date, $5, $6, $7, NULLIF($8, '')::uuid, NULLIF($9, '')::uuid,
			COALESCE((SELECT max(sort_order) + 1 FROM tasks WHERE bucket_id = $1), 0)
		)
		RETURNING id::text, bucket_id::text, title, description,
			COALESCE(scheduled_date::text, ''), kind, status, priority, sort_order, created_at, updated_at
			, COALESCE(assignee_agent_id::text, ''), COALESCE(parent_task_id::text, '')
	`, bucket.ID, title, description, scheduledDate, kind, status, priority, assigneeAgentID, parentTaskID)
	return scanTask(row)
}

func taskByID(ctx context.Context, db queryRower, id string) (Task, error) {
	row := db.QueryRow(ctx, `
		SELECT id::text, bucket_id::text, title, description,
			COALESCE(scheduled_date::text, ''), kind,
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

func taskCreateRequestData(title string, description string, scheduledDate string, kind string, assigneeAgentID string, parentTaskID string) (string, error) {
	raw, err := json.Marshal(struct {
		Title           string `json:"title"`
		Description     string `json:"description"`
		ScheduledDate   string `json:"scheduledDate"`
		Kind            string `json:"kind"`
		AssigneeAgentID string `json:"assigneeAgentId"`
		ParentTaskID    string `json:"parentTaskId"`
	}{title, description, scheduledDate, kind, strings.TrimSpace(assigneeAgentID), parentTaskID})
	return string(raw), err
}

func taskCreateRequestDataV2(title string, description string, scheduledDate string, kind string, status string, priority string, assigneeAgentID string, parentTaskID string) (string, error) {
	raw, err := json.Marshal(struct {
		Title           string `json:"title"`
		Description     string `json:"description"`
		ScheduledDate   string `json:"scheduledDate"`
		Kind            string `json:"kind"`
		Status          string `json:"status"`
		Priority        string `json:"priority"`
		AssigneeAgentID string `json:"assigneeAgentId"`
		ParentTaskID    string `json:"parentTaskId"`
	}{title, description, scheduledDate, kind, status, priority, strings.TrimSpace(assigneeAgentID), parentTaskID})
	return string(raw), err
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
	if current.BucketID != destination.ID && current.Kind == KindAction && current.Status != StatusDone {
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
		SET bucket_id = $2, sort_order = $3, updated_at = now()
		WHERE id = $1
	`, taskID, destination.ID, position)
	return err
}

func updateChildTaskLocations(ctx context.Context, tx pgx.Tx, parentTaskID string, destination Bucket) error {
	_, err := tx.Exec(ctx, `
		UPDATE tasks
		SET bucket_id = $2, updated_at = now()
		WHERE parent_task_id = $1
	`, parentTaskID, destination.ID)
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
	if requiredAgentID != "" {
		var executionRunID string
		if err := tx.QueryRow(ctx, "SELECT COALESCE(execution_run_id::text, '') FROM tasks WHERE id = $1", current.ID).Scan(&executionRunID); err != nil {
			return Task{}, err
		}
		requestedRunID := strings.TrimSpace(input.RunID)
		if executionRunID != "" && requestedRunID != executionRunID {
			return Task{}, ErrManagedRunMismatch
		}
		if executionRunID == "" && requestedRunID != "" {
			return Task{}, ErrManagedRunMismatch
		}
		if executionRunID != "" && (input.Status != nil || input.Done != nil) {
			return Task{}, ErrManagedRunStatusLocked
		}
	}
	original := current
	originalBucketID := current.BucketID
	originalActive := current.Kind == KindAction && current.Status != StatusDone
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
		current.SortOrder = 0
		moveChildren = current.ParentTaskID == ""
	}
	if input.Status != nil {
		if err := applyTaskStatus(&current, *input.Status, allowWorking); err != nil {
			return Task{}, err
		}
	}
	if input.Done != nil {
		// Released clients still send the former completion boolean. Reopening
		// returns the card to the first valid state for its current assignment.
		legacyStatus := current.Status
		if *input.Done {
			legacyStatus = StatusDone
		} else if current.Status == StatusDone {
			legacyStatus = StatusNew
			if current.AssigneeAgentID != "" {
				legacyStatus = StatusQueued
			}
		}
		if legacyStatus != current.Status {
			if err := applyTaskStatus(&current, legacyStatus, allowWorking); err != nil {
				return Task{}, err
			}
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
	if current.AssigneeAgentID != "" && current.Status == StatusNew {
		current.Status = StatusQueued
	}
	if current.AssigneeAgentID != "" && (current.Status == StatusNew || current.Status == StatusQueued || current.Status == StatusWorking) {
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
	currentActive := current.Kind == KindAction && current.Status != StatusDone
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
		SET bucket_id = $3, title = $4, description = $5,
			scheduled_date = NULLIF($6, '')::date, kind = $7,
			status = $8, priority = $9, sort_order = $10,
			assignee_agent_id = NULLIF($11, '')::uuid,
			review_reason = CASE
				WHEN $8 <> 'needs_review' THEN ''
				WHEN t.status <> 'needs_review' THEN ''
				ELSE t.review_reason
			END,
			updated_at = now()
		WHERE t.owner_user_id = $1 AND t.id = $2
		RETURNING t.id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind,
			t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
			COALESCE(t.assignee_agent_id::text, ''), COALESCE(t.parent_task_id::text, '')
	`, userID, id, current.BucketID, current.Title, current.Description, current.ScheduledDate, current.Kind,
		current.Status, current.Priority, current.SortOrder, current.AssigneeAgentID)
	task, err := scanTask(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, ErrNotFound
	}
	if err != nil {
		return Task{}, err
	}
	if moveChildren {
		destination := Bucket{ID: task.BucketID}
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
	return s.claimTask(ctx, userID, "", id, "")
}

func (s *Store) ClaimTaskForAgent(ctx context.Context, userID string, agentID string, id string) (Task, error) {
	return s.claimTask(ctx, userID, agentID, id, "")
}

func (s *Store) ClaimTaskForManagedRun(ctx context.Context, userID string, agentID string, id string, runID string) (Task, error) {
	if !validUUID(runID) {
		return Task{}, fmt.Errorf("%w: run ID must be a valid ID", ErrInvalidData)
	}
	return s.claimTask(ctx, userID, agentID, id, runID)
}

func (s *Store) claimTask(ctx context.Context, userID string, agentID string, id string, runID string) (Task, error) {
	agentSQL := ""
	args := []any{userID, id, StatusWorking, StatusQueued, KindAction, runID}
	if agentID != "" {
		args = append(args, agentID)
		agentSQL = " AND t.assignee_agent_id = $7"
	}
	row := s.db.QueryRow(ctx, `
		UPDATE tasks t
		SET status = $3, review_reason = '', execution_run_id = NULLIF($6, '')::uuid, updated_at = now()
		WHERE t.owner_user_id = $1
			AND t.id = $2
			AND t.kind = $5
			AND t.status = $4
			`+agentSQL+`
		RETURNING t.id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind,
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
			WHERE t.owner_user_id = $2 AND t.bucket_id = $3 AND t.id = $4
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

func (s *Store) ListSubtasks(ctx context.Context, userID string, parentTaskID string) ([]Task, error) {
	parent, err := s.GetTask(ctx, userID, parentTaskID)
	if err != nil {
		return nil, err
	}
	if parent.ParentTaskID != "" {
		return nil, fmt.Errorf("%w: subtasks cannot contain subtasks", ErrInvalidData)
	}
	rows, err := s.db.Query(ctx, `
		SELECT t.id::text, t.bucket_id::text, t.title, '',
			COALESCE(t.scheduled_date::text, ''), t.kind,
			t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
			COALESCE(t.assignee_agent_id::text, ''), COALESCE(t.parent_task_id::text, ''),
			l.name, COALESCE(a.name, ''), parent.title
		FROM tasks t
		JOIN buckets l ON l.id = t.bucket_id
		LEFT JOIN agents a ON a.id = t.assignee_agent_id
		JOIN tasks parent ON parent.id = t.parent_task_id
		WHERE t.owner_user_id = $1 AND t.parent_task_id = $2
		ORDER BY t.sort_order, t.created_at, t.id
	`, userID, parent.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tasks := []Task{}
	for rows.Next() {
		task, err := scanTaskSummary(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (s *Store) ReorderSubtasks(ctx context.Context, userID string, parentTaskID string, ids []string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	parent, err := lockedTask(ctx, tx, userID, parentTaskID)
	if err != nil {
		return err
	}
	if parent.ParentTaskID != "" {
		return fmt.Errorf("%w: subtasks cannot contain subtasks", ErrInvalidData)
	}
	currentIDs, err := orderedChildTaskIDs(ctx, tx, parent.ID)
	if err != nil {
		return err
	}
	if len(ids) != len(currentIDs) {
		return fmt.Errorf("%w: subtask order must include every subtask", ErrInvalidData)
	}
	remaining := make(map[string]struct{}, len(currentIDs))
	for _, id := range currentIDs {
		remaining[id] = struct{}{}
	}
	for _, id := range ids {
		if _, ok := remaining[id]; !ok {
			return fmt.Errorf("%w: subtask order contains an unknown or duplicate task", ErrInvalidData)
		}
		delete(remaining, id)
	}
	if err := writeTaskOrder(ctx, tx, ids); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) GetTask(ctx context.Context, userID string, id string) (Task, error) {
	return s.getTask(ctx, userID, "", id)
}

func (s *Store) GetTaskForAgent(ctx context.Context, userID string, agentID string, id string) (Task, error) {
	return s.getTask(ctx, userID, agentID, id)
}

const inboxPageSize = 50

// ListInbox returns a page of the newest agent-authored entries across an
// account. The cursor is the created_at and id of the last message on the
// previous page, which is the order the index is built for.
func (s *Store) ListInbox(ctx context.Context, userID string, cursor string) ([]InboxMessage, string, error) {
	args := []any{userID, inboxPageSize + 1}
	cursorSQL := ""
	if cursor != "" {
		createdAt, id, err := decodeInboxCursor(cursor)
		if err != nil {
			return nil, "", err
		}
		args = append(args, createdAt, id)
		cursorSQL = " AND (e.created_at, e.id) < ($3, $4)"
	}
	rows, err := s.db.Query(ctx, `
		SELECT e.id::text, e.task_id::text, t.title, e.kind, e.body,
			e.author_id::text, e.author_name, COALESCE(e.run_id::text, ''), e.created_at
		FROM card_entries e
		JOIN tasks t ON t.id = e.task_id
		WHERE t.owner_user_id = $1 AND e.author_kind = 'agent'`+cursorSQL+`
		ORDER BY e.created_at DESC, e.id DESC
		LIMIT $2
	`, args...)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	messages := []InboxMessage{}
	for rows.Next() {
		var message InboxMessage
		if err := rows.Scan(&message.ID, &message.TaskID, &message.TaskTitle, &message.Kind, &message.Body,
			&message.AuthorID, &message.AuthorName, &message.RunID, &message.CreatedAt); err != nil {
			return nil, "", err
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	next := ""
	if len(messages) > inboxPageSize {
		last := messages[inboxPageSize-1]
		messages = messages[:inboxPageSize]
		next = encodeInboxCursor(last.CreatedAt, last.ID)
	}
	return messages, next, nil
}

func encodeInboxCursor(createdAt time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(createdAt.UTC().Format(time.RFC3339Nano) + "|" + id))
}

func decodeInboxCursor(cursor string) (time.Time, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", fmt.Errorf("%w: inbox cursor is not valid", ErrInvalidData)
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 || !validUUID(parts[1]) {
		return time.Time{}, "", fmt.Errorf("%w: inbox cursor is not valid", ErrInvalidData)
	}
	createdAt, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", fmt.Errorf("%w: inbox cursor is not valid", ErrInvalidData)
	}
	return createdAt, parts[1], nil
}

func (s *Store) ListTaskEntries(ctx context.Context, userID string, agentID string, taskID string) ([]TaskEntry, error) {
	return s.listTaskEntries(ctx, userID, agentID, taskID, "")
}

func (s *Store) ListTaskEntriesForRun(ctx context.Context, userID string, agentID string, taskID string, runID string) ([]TaskEntry, error) {
	if !validUUID(runID) {
		return nil, fmt.Errorf("%w: run ID must be a valid ID", ErrInvalidData)
	}
	return s.listTaskEntries(ctx, userID, agentID, taskID, runID)
}

func (s *Store) listTaskEntries(ctx context.Context, userID string, agentID string, taskID string, runID string) ([]TaskEntry, error) {
	if !validUUID(taskID) {
		return nil, fmt.Errorf("%w: task ID must be a valid ID", ErrInvalidData)
	}
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
		WHERE t.owner_user_id = $1 AND t.id = $2`+agentSQL+`
		FOR SHARE OF t
	`, args...).Scan(&authorizedTaskID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	entryArgs := []any{taskID}
	runSQL := ""
	if runID != "" {
		entryArgs = append(entryArgs, runID)
		runSQL = " AND run_id = $2"
	}
	rows, err := tx.Query(ctx, `
		SELECT id::text, task_id::text, kind, body,
			author_kind, author_id::text, author_name, COALESCE(run_id::text, ''), created_at
		FROM card_entries
		WHERE task_id = $1`+runSQL+`
		ORDER BY created_at, id
	`, entryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []TaskEntry{}
	for rows.Next() {
		var entry TaskEntry
		if err := rows.Scan(&entry.ID, &entry.TaskID, &entry.Kind, &entry.Body,
			&entry.AuthorKind, &entry.AuthorID, &entry.AuthorName, &entry.RunID, &entry.CreatedAt); err != nil {
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

func (s *Store) CreateTaskEntry(ctx context.Context, userID string, agentID string, authorName string, taskID string, input CreateTaskEntryInput) (TaskEntry, error) {
	if !validUUID(taskID) {
		return TaskEntry{}, fmt.Errorf("%w: task ID must be a valid ID", ErrInvalidData)
	}
	body := strings.TrimSpace(input.Body)
	kind := strings.TrimSpace(input.Kind)
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	runID := strings.TrimSpace(input.RunID)
	if body == "" {
		return TaskEntry{}, fmt.Errorf("%w: entry body is required", ErrInvalidData)
	}
	if kind != "comment" && kind != "output" {
		return TaskEntry{}, fmt.Errorf("%w: entry kind must be comment or output", ErrInvalidData)
	}
	if len([]byte(body)) > httpapi.TaskEntryBytes {
		return TaskEntry{}, fmt.Errorf("%w: entry body must be %d UTF-8 bytes or fewer", ErrInvalidData, httpapi.TaskEntryBytes)
	}
	if len([]byte(idempotencyKey)) > httpapi.TaskIdempotencyBytes {
		return TaskEntry{}, fmt.Errorf("%w: idempotency key must be %d UTF-8 bytes or fewer", ErrInvalidData, httpapi.TaskIdempotencyBytes)
	}
	if runID != "" && !validUUID(runID) {
		return TaskEntry{}, fmt.Errorf("%w: run ID must be a valid ID", ErrInvalidData)
	}
	if runID != "" && idempotencyKey == "" {
		return TaskEntry{}, fmt.Errorf("%w: managed run entries require an idempotency key", ErrInvalidData)
	}
	authorKind := "human"
	authorID := userID
	if agentID != "" {
		authorKind = "agent"
		authorID = agentID
	}
	fingerprint, err := cardEntryFingerprint(kind, body)
	if err != nil {
		return TaskEntry{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return TaskEntry{}, err
	}
	defer tx.Rollback(ctx)
	if idempotencyKey != "" {
		lockKey := strings.Join([]string{userID, "card-entry", taskID, authorKind, authorID, idempotencyKey}, ":")
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", lockKey); err != nil {
			return TaskEntry{}, err
		}
		replayArgs := []any{userID, taskID, authorKind, authorID, idempotencyKey}
		replayAgentSQL := ""
		if agentID != "" {
			replayArgs = append(replayArgs, agentID)
			replayAgentSQL = " AND t.assignee_agent_id = $6"
			if runID == "" {
				replayAgentSQL += " AND t.execution_run_id IS NULL"
			} else {
				replayArgs = append(replayArgs, runID)
				replayAgentSQL += " AND t.execution_run_id = $7"
			}
		}
		var existing TaskEntry
		var existingFingerprint string
		err := tx.QueryRow(ctx, `
			SELECT e.id::text, e.task_id::text, e.kind, e.body,
				e.author_kind, e.author_id::text, e.author_name, COALESCE(e.run_id::text, ''), e.created_at,
				e.request_hash, t.status, COALESCE(t.review_reason, '')
			FROM card_entries e
			JOIN tasks t ON t.id = e.task_id
			WHERE t.owner_user_id = $1 AND e.task_id = $2 AND e.author_kind = $3
				AND e.author_id = $4 AND e.idempotency_key = $5`+replayAgentSQL+`
		`, replayArgs...).Scan(
			&existing.ID, &existing.TaskID, &existing.Kind, &existing.Body,
			&existing.AuthorKind, &existing.AuthorID, &existing.AuthorName, &existing.RunID, &existing.CreatedAt,
			&existingFingerprint, &existing.TaskStatus, &existing.TaskReviewReason,
		)
		if err == nil {
			if existingFingerprint != fingerprint || existing.RunID != runID {
				return TaskEntry{}, ErrIdempotencyKey
			}
			if existing.RunID != "" {
				existing.TaskStatus = StatusWorking
				existing.TaskReviewReason = ""
				if existing.Kind == "output" {
					existing.TaskStatus = StatusNeedsReview
					existing.TaskReviewReason = "output"
				}
			}
			return existing, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return TaskEntry{}, err
		}
	}
	quota, err := lockStorageQuota(ctx, tx, userID)
	if err != nil {
		return TaskEntry{}, err
	}
	args := []any{userID, taskID}
	agentSQL := ""
	if agentID != "" {
		args = append(args, agentID)
		agentSQL = " AND t.assignee_agent_id = $3"
	}
	var authorizedTaskID, cardStatus, cardReviewReason, executionRunID string
	if err := tx.QueryRow(ctx, `
		SELECT t.id::text, t.status, COALESCE(t.review_reason, ''), COALESCE(t.execution_run_id::text, '')
		FROM tasks t
		WHERE t.owner_user_id = $1 AND t.id = $2`+agentSQL+`
		FOR UPDATE OF t
	`, args...).Scan(&authorizedTaskID, &cardStatus, &cardReviewReason, &executionRunID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return TaskEntry{}, ErrNotFound
		}
		return TaskEntry{}, err
	}
	if agentID != "" {
		if executionRunID != "" {
			if runID == "" || runID != executionRunID {
				return TaskEntry{}, ErrManagedRunMismatch
			}
			if cardStatus != StatusWorking {
				return TaskEntry{}, ErrTaskUnavailable
			}
		} else if runID != "" {
			return TaskEntry{}, ErrManagedRunMismatch
		}
		if err := tx.QueryRow(ctx, `
			SELECT name FROM agents
			WHERE id = $1 AND owner_user_id = $2 AND archived_at IS NULL
		`, agentID, userID).Scan(&authorName); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return TaskEntry{}, ErrNotFound
			}
			return TaskEntry{}, err
		}
	}
	authorName = strings.TrimSpace(authorName)
	if authorName == "" {
		authorName = "You"
	}
	var entryCount int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM card_entries WHERE task_id = $1", taskID).Scan(&entryCount); err != nil {
		return TaskEntry{}, err
	}
	if entryCount >= MaxTaskEntries {
		return TaskEntry{}, fmt.Errorf("%w: tasks can contain at most %d conversation entries", ErrInvalidData, MaxTaskEntries)
	}
	var entry TaskEntry
	err = tx.QueryRow(ctx, `
		INSERT INTO card_entries (task_id, kind, body, author_kind, author_id, author_name, idempotency_key, request_hash, run_id)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, NULLIF($9, '')::uuid)
		RETURNING id::text, task_id::text, kind, body,
			author_kind, author_id::text, author_name, COALESCE(run_id::text, ''), created_at
	`, taskID, kind, body, authorKind, authorID, authorName, idempotencyKey, fingerprint, runID).Scan(
		&entry.ID, &entry.TaskID, &entry.Kind, &entry.Body,
		&entry.AuthorKind, &entry.AuthorID, &entry.AuthorName, &entry.RunID, &entry.CreatedAt,
	)
	if err != nil {
		return TaskEntry{}, err
	}
	if err := quota.apply(ctx, tx, 0, int64(len([]byte(body)))); err != nil {
		return TaskEntry{}, err
	}
	if kind == "output" {
		query := `
			UPDATE tasks
			SET status = $1, review_reason = 'output', updated_at = now()
			WHERE id = $2
		`
		updateArgs := []any{StatusNeedsReview, taskID}
		if runID != "" {
			query += " AND status = 'working' AND execution_run_id = $3"
			updateArgs = append(updateArgs, runID)
		}
		tag, err := tx.Exec(ctx, query, updateArgs...)
		if err != nil {
			return TaskEntry{}, err
		}
		if tag.RowsAffected() != 1 {
			return TaskEntry{}, ErrManagedRunMismatch
		}
		cardStatus = StatusNeedsReview
		cardReviewReason = "output"
	}
	entry.TaskStatus = cardStatus
	entry.TaskReviewReason = cardReviewReason
	if err := tx.Commit(ctx); err != nil {
		return TaskEntry{}, err
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
		SELECT t.id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind,
			t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
			COALESCE(t.assignee_agent_id::text, ''), COALESCE(t.parent_task_id::text, ''),
			COALESCE(t.execution_run_id::text, '')
		FROM tasks t
		WHERE t.owner_user_id = $1 AND t.id = $2
			`+agentSQL+`
	`, args...)
	task, err := scanTaskWithExecutionRun(row)
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
	if filter.BucketID != "" {
		args = append(args, filter.BucketID)
		whereSQL += fmt.Sprintf(" AND t.bucket_id = $%d", len(args))
	}
	if filter.Status != "" {
		args = append(args, filter.Status)
		whereSQL += fmt.Sprintf(" AND t.status = $%d", len(args))
	}
	if filter.Done != nil {
		if *filter.Done {
			whereSQL += " AND t.status = 'done'"
		} else {
			whereSQL += " AND t.status <> 'done'"
		}
	}
	if filter.Priority != "" {
		args = append(args, filter.Priority)
		whereSQL += fmt.Sprintf(" AND t.priority = $%d", len(args))
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
	completedHistory := filter.Status == StatusDone
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
	const agentQueuePrioritySQL = "CASE t.priority WHEN 'p0' THEN 0 WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 ELSE 3 END"
	orderSQL := "t.created_at DESC, t.id DESC"
	if filter.AgentQueue {
		orderSQL = agentQueuePrioritySQL + ", t.created_at, t.id"
	}
	if completedHistory {
		orderSQL = "t.updated_at DESC, t.id DESC"
	}
	if filter.Cursor != "" {
		if filter.AgentQueue {
			cursor, err := decodeAgentQueueCursor(filter.Cursor, taskCursorScope(userID, filter))
			if err != nil {
				return TaskPage{}, err
			}
			args = append(args, cursor.PriorityRank, cursor.CreatedAt, cursor.ID)
			whereSQL += fmt.Sprintf(
				" AND (%s > $%d OR (%s = $%d AND (t.created_at > $%d OR (t.created_at = $%d AND t.id > $%d::uuid))))",
				agentQueuePrioritySQL, len(args)-2, agentQueuePrioritySQL, len(args)-2, len(args)-1, len(args)-1, len(args),
			)
		} else {
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
	}
	fetchLimit := limit + 1
	args = append(args, fetchLimit)
	query := `
		SELECT t.id::text, t.bucket_id::text, t.title, '',
			COALESCE(t.scheduled_date::text, ''), t.kind,
			t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
			COALESCE(t.assignee_agent_id::text, ''), COALESCE(t.parent_task_id::text, ''),
			l.name, COALESCE(a.name, ''), COALESCE(parent.title, '')
		FROM tasks t
		JOIN buckets l ON l.id = t.bucket_id
		LEFT JOIN agents a ON a.id = t.assignee_agent_id
		LEFT JOIN tasks parent ON parent.id = t.parent_task_id
			AND parent.bucket_id = t.bucket_id
		WHERE t.owner_user_id = $1` + whereSQL + `
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
		if filter.AgentQueue {
			page.NextCursor, err = encodeAgentQueueCursor(cursorTask, taskCursorScope(userID, filter))
			if err != nil {
				return TaskPage{}, err
			}
		} else {
			if !completedHistory {
				cursorTask.UpdatedAt = cursorTask.CreatedAt
			}
			page.NextCursor, err = encodeCompletedTaskCursor(cursorTask, taskCursorScope(userID, filter))
			if err != nil {
				return TaskPage{}, err
			}
		}
	}
	return page, nil
}

func taskSearchPattern(query string) string {
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(query)
	return "%" + escaped + "%"
}

func (s *Store) getBucket(ctx context.Context, userID string, id string) (Bucket, error) {
	row := s.db.QueryRow(ctx, `
		SELECT b.id::text, b.name, b.goal, b.is_inbox, b.limit_count, b.sort_order,
			COUNT(t.id) FILTER (WHERE t.kind = 'action' AND t.status <> 'done' AND t.parent_task_id IS NULL)::int AS open_count,
			b.created_at, b.updated_at
		FROM buckets b
		LEFT JOIN tasks t ON t.bucket_id = b.id
		WHERE b.user_id = $1 AND b.id = $2
		GROUP BY b.id
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
		SELECT b.id::text, b.name, b.goal, b.is_inbox,
			b.limit_count, b.sort_order, b.created_at, b.updated_at
		FROM buckets b
		WHERE b.user_id = $1 AND b.id = $2
		FOR UPDATE OF b
	`, userID, id).Scan(
		&bucket.ID, &bucket.Name, &bucket.Goal, &bucket.IsInbox,
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
		SELECT t.id::text, t.bucket_id::text, t.title, t.description,
			COALESCE(t.scheduled_date::text, ''), t.kind,
			t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
			COALESCE(t.assignee_agent_id::text, ''), COALESCE(t.parent_task_id::text, '')
		FROM tasks t
		WHERE t.owner_user_id = $1 AND t.id = $2
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
			SELECT t.id, t.bucket_id, t.title, COALESCE(t.scheduled_date::text, '') AS scheduled_date,
				t.kind, t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
				COALESCE(t.assignee_agent_id::text, '') AS assignee_agent_id,
				COALESCE(t.parent_task_id::text, '') AS parent_task_id, false AS completed_history
			FROM tasks t
			WHERE t.owner_user_id = $1 AND t.bucket_id = $2 AND t.status <> 'done'
		), completed AS (
			SELECT t.id, t.bucket_id, t.title, COALESCE(t.scheduled_date::text, '') AS scheduled_date,
				t.kind, t.status, t.priority, t.sort_order, t.created_at, t.updated_at,
				COALESCE(t.assignee_agent_id::text, '') AS assignee_agent_id,
				COALESCE(t.parent_task_id::text, '') AS parent_task_id, true AS completed_history
			FROM tasks t
			WHERE t.owner_user_id = $1 AND t.bucket_id = $2 AND t.status = 'done'
			ORDER BY t.updated_at DESC, t.id DESC
			LIMIT 21
		), selected AS (
			SELECT * FROM active
			UNION ALL
			SELECT * FROM completed
		)
		SELECT id::text, bucket_id::text, title, '', scheduled_date, kind,
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
		cursor, err := encodeCompletedTaskCursor(completed[len(completed)-1], taskCursorScope(userID, TaskFilter{BucketID: bucketID, Status: StatusDone}))
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
			WHERE t.kind = 'action' AND t.status <> 'done'
				AND ($2 = '' OR t.id <> NULLIF($2, '')::uuid)
		) >= bo.max_tasks_per_list
		FROM buckets b
				LEFT JOIN tasks t ON t.bucket_id = b.id
		WHERE b.id = $1
		GROUP BY b.id, bo.max_tasks_per_list
	`, bucketID, taskID).Scan(&full)
	return full, err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanBucket(row rowScanner) (Bucket, error) {
	var bucket Bucket
	err := row.Scan(
		&bucket.ID, &bucket.Name, &bucket.Goal, &bucket.IsInbox, &bucket.LimitCount,
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
	destinations := append(taskScanDestinations(&task), &task.BucketName, &task.AssigneeAgentName, &task.ParentTaskTitle)
	err := row.Scan(destinations...)
	return task, err
}

func scanTaskWithExecutionRun(row rowScanner) (Task, error) {
	var task Task
	destinations := append(taskScanDestinations(&task), &task.ExecutionRunID)
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
		&task.ID, &task.BucketID, &task.Title, &task.Description, &task.ScheduledDate, &task.Kind,
		&task.Status, &task.Priority,
		&task.SortOrder, &task.CreatedAt, &task.UpdatedAt,
		&task.AssigneeAgentID,
		&task.ParentTaskID,
	}
}

func taskCursorScope(userID string, filter TaskFilter) string {
	parts := []string{
		userID, filter.BucketID, filter.Status, filter.Priority,
		fmt.Sprint(filter.ActionsOnly), filter.AssigneeAgentID, fmt.Sprint(filter.Unassigned),
		filter.Query, filter.ScheduledFrom, filter.ScheduledTo, filter.ParentTaskID, fmt.Sprint(filter.TopLevelOnly),
		fmt.Sprint(filter.InboxOnly),
		fmt.Sprint(filter.AgentQueue),
	}
	// done=true is the released spelling of status=done and must share its
	// existing cursor scope. The open-only alias does not issue history cursors.
	if filter.Done != nil && !(*filter.Done && filter.Status == StatusDone) {
		parts = append(parts, fmt.Sprintf("done=%t", *filter.Done))
	}
	value := strings.Join(parts, "\x00")
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

func encodeAgentQueueCursor(task Task, scope string) (string, error) {
	encoded, err := json.Marshal(agentQueueCursor{
		PriorityRank: agentQueuePriorityRank(task.Priority),
		CreatedAt:    task.CreatedAt.UTC(),
		ID:           task.ID,
		Scope:        scope,
	})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func decodeAgentQueueCursor(raw string, scope string) (agentQueueCursor, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return agentQueueCursor{}, fmt.Errorf("%w: invalid cursor", ErrInvalidData)
	}
	var cursor agentQueueCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.CreatedAt.IsZero() || !validUUID(cursor.ID) || cursor.Scope != scope || cursor.PriorityRank < 0 || cursor.PriorityRank > 3 {
		return agentQueueCursor{}, fmt.Errorf("%w: invalid cursor", ErrInvalidData)
	}
	return cursor, nil
}

func agentQueuePriorityRank(priority string) int {
	switch priority {
	case PriorityP0:
		return 0
	case PriorityP1:
		return 1
	case PriorityP2:
		return 2
	default:
		return 3
	}
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
