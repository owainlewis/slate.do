package boards

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/entitlements"
)

func TestStoredTaskQuotaExactLimitDeleteAndConcurrentCreates(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID, _, bucket := createFreeQuotaAccount(t, ctx, db, store)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	seedCompletedTasks(t, ctx, db, bucket.ID, entitlements.FreeLimits.StoredTasks-1, "x")
	created, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "exact", OverrideLimit: true})
	if err != nil {
		t.Fatalf("create at exact task limit: %v", err)
	}
	assertStorageUsage(t, ctx, db, userID, int64(entitlements.FreeLimits.StoredTasks), int64(entitlements.FreeLimits.StoredTasks-1+len("exact")))

	_, err = store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "over", OverrideLimit: true})
	assertQuotaError(t, err, StoredTaskLimitCode, int64(entitlements.FreeLimits.StoredTasks), int64(entitlements.FreeLimits.StoredTasks))

	if err := store.DeleteTask(ctx, userID, created.ID); err != nil {
		t.Fatal(err)
	}
	again, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "again", OverrideLimit: true})
	if err != nil {
		t.Fatalf("create after delete released capacity: %v", err)
	}

	// Return to one slot below the cap, then race several writers for it.
	if err := store.DeleteTask(ctx, userID, again.ID); err != nil {
		t.Fatal(err)
	}
	results := runConcurrently(8, func(index int) error {
		_, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: fmt.Sprintf("race-%d", index), OverrideLimit: true})
		return err
	})
	assertConcurrentQuotaResults(t, results, 1, StoredTaskLimitCode)
	usage, err := accountStorageUsage(ctx, db, userID, false)
	if err != nil {
		t.Fatal(err)
	}
	if usage.Tasks != int64(entitlements.FreeLimits.StoredTasks) {
		t.Fatalf("stored tasks after race = %d", usage.Tasks)
	}
}

func TestStoredContentQuotaExactLimitEditLifecycleAndConcurrentWrites(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID, board, bucket := createFreeQuotaAccount(t, ctx, db, store)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	limit := entitlements.FreeLimits.StoredContentBytes
	seedCompletedTasks(t, ctx, db, bucket.ID, 1, strings.Repeat("a", int(limit-1)))
	exact, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "é", OverrideLimit: true})
	assertQuotaError(t, err, StoredContentLimitCode, limit-1, limit)
	if exact.ID != "" {
		t.Fatalf("rejected task was returned: %#v", exact)
	}

	// Replace the two-byte title attempt with one byte to reach the exact cap.
	exact, err = store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: "b", OverrideLimit: true})
	if err != nil {
		t.Fatalf("create at exact content limit: %v", err)
	}
	assertStorageUsage(t, ctx, db, userID, 2, limit)

	larger := "bb"
	_, err = store.UpdateTask(ctx, userID, exact.ID, UpdateTaskInput{Title: &larger})
	assertQuotaError(t, err, StoredContentLimitCode, limit, limit)

	// State and location changes remain available while usage is exactly full.
	done := true
	completed, err := store.UpdateTask(ctx, userID, exact.ID, UpdateTaskInput{Done: &done})
	if err != nil || !completed.Done {
		t.Fatalf("complete at limit: task=%#v err=%v", completed, err)
	}
	done = false
	reopened, err := store.UpdateTask(ctx, userID, exact.ID, UpdateTaskInput{Done: &done})
	if err != nil || reopened.Done {
		t.Fatalf("reopen at limit: task=%#v err=%v", reopened, err)
	}
	destination, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Destination", LimitCount: 20})
	if err != nil {
		t.Fatal(err)
	}
	position := 0
	if _, err := store.MoveTask(ctx, userID, exact.ID, MoveTaskInput{BucketID: destination.ID, Position: &position}); err != nil {
		t.Fatalf("move at limit: %v", err)
	}
	assertStorageUsage(t, ctx, db, userID, 2, limit)

	shorter := ""
	// The title cannot be empty, so reduce the large completed task instead.
	var seededID string
	if err := db.QueryRow(ctx, "SELECT id::text FROM tasks WHERE bucket_id = $1 AND id <> $2", bucket.ID, exact.ID).Scan(&seededID); err != nil {
		t.Fatal(err)
	}
	shortTitle := "a"
	if _, err := store.UpdateTask(ctx, userID, seededID, UpdateTaskInput{Title: &shortTitle, Description: &shorter}); err != nil {
		t.Fatalf("content reduction at limit: %v", err)
	}
	if err := store.DeleteTask(ctx, userID, exact.ID); err != nil {
		t.Fatal(err)
	}
	assertStorageUsage(t, ctx, db, userID, 1, 1)

	// Leave eight bytes and race eight-byte writes. Only one may consume them.
	fill := strings.Repeat("z", int(limit-9))
	if _, err := store.UpdateTask(ctx, userID, seededID, UpdateTaskInput{Description: &fill}); err != nil {
		t.Fatal(err)
	}
	results := runConcurrently(8, func(index int) error {
		_, err := store.CreateTask(ctx, userID, bucket.ID, CreateTaskInput{Title: fmt.Sprintf("item%04d", index), OverrideLimit: true})
		return err
	})
	assertConcurrentQuotaResults(t, results, 1, StoredContentLimitCode)
	usage, err := accountStorageUsage(ctx, db, userID, false)
	if err != nil {
		t.Fatal(err)
	}
	if usage.ContentBytes != limit {
		t.Fatalf("stored content after race = %d, want %d", usage.ContentBytes, limit)
	}
}

func TestOverLimitAccountCanReadCompleteReduceAndDelete(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID, _, bucket := createFreeQuotaAccount(t, ctx, db, store)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	seedCompletedTasks(t, ctx, db, bucket.ID, 1, strings.Repeat("x", int(entitlements.FreeLimits.StoredContentBytes+1)))
	listed, err := store.ListTasks(ctx, userID, TaskFilter{})
	if err != nil || len(listed) != 1 {
		t.Fatalf("read while over limit: tasks=%d err=%v", len(listed), err)
	}

	done := false
	reopened, err := store.UpdateTask(ctx, userID, listed[0].ID, UpdateTaskInput{Done: &done})
	if err != nil || reopened.Done {
		t.Fatalf("reopen while over limit: task=%#v err=%v", reopened, err)
	}
	done = true
	if _, err := store.UpdateTask(ctx, userID, listed[0].ID, UpdateTaskInput{Done: &done}); err != nil {
		t.Fatalf("complete while over limit: %v", err)
	}

	shorter := "small"
	if _, err := store.UpdateTask(ctx, userID, listed[0].ID, UpdateTaskInput{Title: &shorter}); err != nil {
		t.Fatalf("reduce while over limit: %v", err)
	}
	assertStorageUsage(t, ctx, db, userID, 1, int64(len(shorter)))
	if err := store.DeleteTask(ctx, userID, listed[0].ID); err != nil {
		t.Fatalf("delete after reduction: %v", err)
	}
	assertStorageUsage(t, ctx, db, userID, 0, 0)
}

func TestDeletingBucketsAndBoardsReleasesCascadeTaskUsage(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID, board, first := createFreeQuotaAccount(t, ctx, db, store)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })
	second, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Second", LimitCount: 20})
	if err != nil {
		t.Fatal(err)
	}
	firstTask, err := store.CreateTask(ctx, userID, first.ID, CreateTaskInput{Title: "first", OverrideLimit: true})
	if err != nil {
		t.Fatal(err)
	}
	secondTask, err := store.CreateTask(ctx, userID, second.ID, CreateTaskInput{Title: "second", OverrideLimit: true})
	if err != nil {
		t.Fatal(err)
	}
	assertStorageUsage(t, ctx, db, userID, 2, taskContentBytes(firstTask)+taskContentBytes(secondTask))

	if err := store.DeleteBucket(ctx, userID, first.ID); err != nil {
		t.Fatalf("delete bucket: %v", err)
	}
	assertStorageUsage(t, ctx, db, userID, 1, taskContentBytes(secondTask))
	if err := store.DeleteBoard(ctx, userID, board.ID); err != nil {
		t.Fatalf("delete board: %v", err)
	}
	assertStorageUsage(t, ctx, db, userID, 0, 0)
}

func createFreeQuotaAccount(t *testing.T, ctx context.Context, db *database.Pool, store *Store) (string, Board, Bucket) {
	t.Helper()
	userID := createFreeIntegrationUser(t, ctx, db)
	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Quota"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Tasks", LimitCount: 20})
	if err != nil {
		t.Fatal(err)
	}
	return userID, board, bucket
}

func seedCompletedTasks(t *testing.T, ctx context.Context, db *database.Pool, bucketID string, count int, title string) {
	t.Helper()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SELECT set_config('slate.storage_quota_managed', 'on', true)"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, description, kind, done, status, sort_order)
		SELECT b.board_id, b.id, $3, '', 'action', true, 'done', generated
		FROM buckets b CROSS JOIN generate_series(1, $2::integer) AS generated
		WHERE b.id = $1
	`, bucketID, count, title); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO account_storage_usage (user_id, stored_tasks, stored_content_bytes)
		SELECT bo.user_id, $2, $2::bigint * octet_length($3)
		FROM buckets bu
		JOIN boards bo ON bo.id = bu.board_id
		WHERE bu.id = $1
		ON CONFLICT (user_id) DO UPDATE
		SET stored_tasks = account_storage_usage.stored_tasks + EXCLUDED.stored_tasks,
			stored_content_bytes = account_storage_usage.stored_content_bytes + EXCLUDED.stored_content_bytes,
			updated_at = now()
	`, bucketID, count, title); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

func assertStorageUsage(t *testing.T, ctx context.Context, db *database.Pool, userID string, tasks int64, contentBytes int64) {
	t.Helper()
	usage, err := accountStorageUsage(ctx, db, userID, false)
	if err != nil {
		t.Fatal(err)
	}
	if usage.Tasks != tasks || usage.ContentBytes != contentBytes {
		t.Fatalf("usage = %#v, want tasks=%d content=%d", usage, tasks, contentBytes)
	}
}

func assertQuotaError(t *testing.T, err error, code string, current int64, limit int64) {
	t.Helper()
	var quota *StorageQuotaError
	if !errors.As(err, &quota) {
		t.Fatalf("error = %v, want StorageQuotaError", err)
	}
	if quota.Code != code || quota.Current != current || quota.Limit != limit {
		t.Fatalf("quota error = %#v, want code=%q current=%d limit=%d", quota, code, current, limit)
	}
}

func assertConcurrentQuotaResults(t *testing.T, results []error, wantSuccesses int, code string) {
	t.Helper()
	var successes, limited int
	for _, err := range results {
		if err == nil {
			successes++
			continue
		}
		var quota *StorageQuotaError
		if errors.As(err, &quota) && quota.Code == code {
			limited++
			continue
		}
		t.Fatalf("unexpected concurrent error: %v", err)
	}
	if successes != wantSuccesses || successes+limited != len(results) {
		t.Fatalf("concurrent results: successes=%d limited=%d total=%d", successes, limited, len(results))
	}
}
