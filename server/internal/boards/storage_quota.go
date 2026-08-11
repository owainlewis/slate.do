package boards

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/owainlewis/slate.do/server/internal/entitlements"
)

const (
	StoredTaskLimitCode    = "stored_task_limit_reached"
	StoredContentLimitCode = "stored_content_limit_reached"
)

// StorageQuotaError describes the committed usage that caused a write to be
// rejected. The rejected write is not included in Current.
type StorageQuotaError struct {
	Code    string
	Current int64
	Limit   int64
}

func (e *StorageQuotaError) Error() string {
	return fmt.Sprintf("%s: current usage is %d and the limit is %d", e.Code, e.Current, e.Limit)
}

type storageUsage struct {
	Tasks        int64
	ContentBytes int64
}

type storageQuota struct {
	userID string
	limits entitlements.Limits
	usage  storageUsage
}

// lockStorageQuota locks the account and its bounded-cost usage counters.
// Every task transaction that changes measured storage takes the account and
// usage locks before task rows. The database trigger skips unchanged storage
// updates so status and metadata-only writes never reverse this order.
func lockStorageQuota(ctx context.Context, tx pgx.Tx, userID string) (*storageQuota, error) {
	limits, err := accountLimitsForUpdate(ctx, tx, userID)
	if err != nil {
		return nil, err
	}
	// Migrations populate existing accounts. Accounts created later start at zero
	// before their first task write.
	if _, err := tx.Exec(ctx, `
		INSERT INTO account_storage_usage (user_id)
		VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING
	`, userID); err != nil {
		return nil, err
	}
	usage, err := accountStorageUsage(ctx, tx, userID, true)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, "SELECT set_config('slate.storage_quota_managed', 'on', true)"); err != nil {
		return nil, err
	}
	return &storageQuota{userID: userID, limits: limits, usage: usage}, nil
}

func (q *storageQuota) apply(ctx context.Context, tx pgx.Tx, taskDelta int64, contentDelta int64) error {
	if taskDelta == 0 && contentDelta == 0 {
		return nil
	}
	if taskDelta > 0 && q.usage.Tasks+taskDelta > int64(q.limits.StoredTasks) {
		return &StorageQuotaError{Code: StoredTaskLimitCode, Current: q.usage.Tasks, Limit: int64(q.limits.StoredTasks)}
	}
	if contentDelta > 0 && q.usage.ContentBytes+contentDelta > q.limits.StoredContentBytes {
		return &StorageQuotaError{Code: StoredContentLimitCode, Current: q.usage.ContentBytes, Limit: q.limits.StoredContentBytes}
	}
	projected := storageUsage{Tasks: q.usage.Tasks + taskDelta, ContentBytes: q.usage.ContentBytes + contentDelta}
	if projected.Tasks < 0 || projected.ContentBytes < 0 {
		return fmt.Errorf("storage quota counters would become negative for user %s", q.userID)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE account_storage_usage
		SET stored_tasks = $2, stored_content_bytes = $3, updated_at = now()
		WHERE user_id = $1
	`, q.userID, projected.Tasks, projected.ContentBytes); err != nil {
		return err
	}
	q.usage = projected
	return nil
}

func accountStorageUsage(ctx context.Context, db queryRower, userID string, lock bool) (storageUsage, error) {
	lockSQL := ""
	if lock {
		lockSQL = " FOR UPDATE"
	}
	var usage storageUsage
	err := db.QueryRow(ctx, `
		SELECT stored_tasks, stored_content_bytes
		FROM account_storage_usage
		WHERE user_id = $1`+lockSQL, userID).Scan(&usage.Tasks, &usage.ContentBytes)
	return usage, err
}

func lockedBoardTaskStorage(ctx context.Context, tx pgx.Tx, boardID string) (storageUsage, error) {
	return lockedTaskStorage(ctx, tx, `
		WITH RECURSIVE cascade_tasks AS (
			SELECT t.id
			FROM tasks t
			WHERE t.board_id = $1

			UNION

			SELECT child.id
			FROM tasks child
			JOIN cascade_tasks parent ON parent.id = child.parent_task_id
		)
		SELECT t.storage_bytes + COALESCE((
			SELECT sum(octet_length(entry.body))
			FROM card_entries entry
			WHERE entry.task_id = t.id
		), 0)
		FROM tasks t
		JOIN cascade_tasks deleted_task ON deleted_task.id = t.id
		FOR UPDATE OF t
	`, boardID)
}

func lockedBucketTaskStorage(ctx context.Context, tx pgx.Tx, bucketID string) (storageUsage, error) {
	return lockedTaskStorage(ctx, tx, `
		WITH RECURSIVE cascade_tasks AS (
			SELECT t.id
			FROM tasks t
			WHERE t.bucket_id = $1

			UNION

			SELECT child.id
			FROM tasks child
			JOIN cascade_tasks parent ON parent.id = child.parent_task_id
		)
		SELECT t.storage_bytes + COALESCE((
			SELECT sum(octet_length(entry.body))
			FROM card_entries entry
			WHERE entry.task_id = t.id
		), 0)
		FROM tasks t
		JOIN cascade_tasks deleted_task ON deleted_task.id = t.id
		FOR UPDATE OF t
	`, bucketID)
}

func lockedTaskStorage(ctx context.Context, tx pgx.Tx, sql string, id string) (storageUsage, error) {
	rows, err := tx.Query(ctx, sql, id)
	if err != nil {
		return storageUsage{}, err
	}
	defer rows.Close()
	var usage storageUsage
	for rows.Next() {
		var contentBytes int64
		if err := rows.Scan(&contentBytes); err != nil {
			return storageUsage{}, err
		}
		usage.Tasks++
		usage.ContentBytes += contentBytes
	}
	return usage, rows.Err()
}

func taskContentBytes(task Task) int64 {
	return int64(len(task.Title) + len(task.Description))
}

func inputContentBytes(title string, description string) int64 {
	return int64(len(title) + len(description))
}
