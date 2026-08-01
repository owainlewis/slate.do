package database

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

func TestConfiguredPoolCapsConnectionsAndTimesOutAcquisition(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run database integration tests")
	}
	ctx := context.Background()
	db, err := Open(ctx, databaseURL, Options{
		MaxConnections:         2,
		AcquireTimeout:         50 * time.Millisecond,
		StatementTimeout:       200 * time.Millisecond,
		IdleTransactionTimeout: 300 * time.Millisecond,
		MaxConnectionIdleTime:  time.Minute,
		MaxConnectionLifetime:  2 * time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)

	if db.MaxConnections() != 2 || db.Stat().MaxConns() != 2 {
		t.Fatalf("configured max = %d, pool max = %d", db.MaxConnections(), db.Stat().MaxConns())
	}
	var statementTimeout, idleTransactionTimeout string
	if err := db.QueryRow(ctx, `
		SELECT current_setting('statement_timeout'), current_setting('idle_in_transaction_session_timeout')
	`).Scan(&statementTimeout, &idleTransactionTimeout); err != nil {
		t.Fatal(err)
	}
	if statementTimeout != "200ms" || idleTransactionTimeout != "300ms" {
		t.Fatalf("statement timeout = %q, idle transaction timeout = %q", statementTimeout, idleTransactionTimeout)
	}
	if _, err := db.Exec(ctx, "SELECT pg_sleep(0.1)"); err != nil {
		t.Fatalf("acquisition timeout incorrectly limited statement execution: %v", err)
	}
	if _, err := db.Exec(ctx, "SELECT pg_sleep(0.3)"); !IsCapacityError(err) {
		t.Fatalf("statement timeout error = %v, want capacity error", err)
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(400 * time.Millisecond)
	if _, err := tx.Exec(ctx, "SELECT 1"); !IsCapacityError(err) {
		t.Fatalf("idle transaction timeout error = %v, want capacity error", err)
	}
	_ = tx.Rollback(ctx)
	maximum, current, err := db.ServerCapacity(ctx)
	if err != nil || maximum < 1 || current < 1 || current > maximum {
		t.Fatalf("server capacity = maximum %d, current %d, error %v", maximum, current, err)
	}

	first, err := db.Pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	second, err := db.Pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Release()

	started := time.Now()
	_, err = db.Exec(ctx, "SELECT 1")
	if !errors.Is(err, context.DeadlineExceeded) || !IsCapacityError(err) {
		t.Fatalf("error = %v, want capacity deadline exceeded", err)
	}
	if elapsed := time.Since(started); elapsed < 40*time.Millisecond || elapsed > 500*time.Millisecond {
		t.Fatalf("acquisition timeout took %s", elapsed)
	}
}

func TestApplicationConnectionLimitIsSharedAcrossPools(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run database integration tests")
	}
	options := Options{
		MaxConnections:          2,
		AcquireTimeout:          100 * time.Millisecond,
		StatementTimeout:        time.Second,
		IdleTransactionTimeout:  time.Second,
		MaxConnectionIdleTime:   time.Minute,
		MaxConnectionLifetime:   2 * time.Minute,
		ConnectionLimit:         3,
		ConnectionLockNamespace: int32(time.Now().UnixNano()&0x7ffffffe) | 1,
	}
	ctx := context.Background()
	first, err := Open(ctx, databaseURL, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(first.Close)
	second, err := Open(ctx, databaseURL, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(second.Close)

	firstOne, err := first.Pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer firstOne.Release()
	firstTwo, err := first.Pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer firstTwo.Release()
	secondOne, err := second.Pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer secondOne.Release()

	if _, err := second.acquire(ctx); !IsCapacityError(err) {
		t.Fatalf("fourth shared connection error = %v, want capacity error", err)
	}
}
