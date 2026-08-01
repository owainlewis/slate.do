package ratelimit

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/migrations"
)

func TestSharedRollingLimitsEnforceThresholdResetAndConcurrency(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run rate-limit integration tests")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}

	fixedNow := time.Date(2100, time.January, 1, 0, 0, 5, 0, time.UTC).
		Add(time.Duration(time.Now().UnixNano()%1_000_000) * time.Minute)
	first := NewPG(db)
	second := NewPG(db)
	first.now = func() time.Time { return fixedNow }
	second.now = first.now
	first.cleanupExpired = false
	second.cleanupExpired = false
	account := fmt.Sprintf("account-%d", time.Now().UnixNano())
	credential := fmt.Sprintf("credential-%d", time.Now().UnixNano())
	keys := []Key{{Scope: ScopeAccount, Value: account}, {Scope: ScopeCredential, Value: credential}}
	t.Cleanup(func() {
		cleanupRateLimitTestData(t, db, []Key{
			{Scope: ScopeAccount, Value: account},
			{Scope: ScopeCredential, Value: credential},
			{Scope: ScopeAccount, Value: account + "-concurrent"},
			{Scope: ScopeCredential, Value: credential + "-concurrent"},
			{Scope: ScopeAccount, Value: account + "-write"},
			{Scope: ScopeCredential, Value: credential + "-write"},
			{Scope: ScopeIP, Value: "ip-" + account},
		}, []time.Time{
			fixedNow, fixedNow.Add(time.Minute), fixedNow.Add(2 * time.Minute),
			fixedNow.Add(3 * time.Minute), fixedNow.Add(4 * time.Minute),
		})
	})

	for request := 1; request <= 120; request++ {
		limiter := first
		if request%2 == 0 {
			limiter = second
		}
		decision, err := limiter.Allow(ctx, keys, ClassAuthenticatedRead)
		if err != nil || !decision.Allowed || decision.Limit != 120 || decision.Remaining != 120-request {
			t.Fatalf("request %d decision = %#v, error = %v", request, decision, err)
		}
	}
	rejected, err := second.Allow(ctx, keys, ClassAuthenticatedRead)
	if err != nil || rejected.Allowed || RetryAfterSeconds(rejected.RetryAfter) != 60 {
		t.Fatalf("rejected decision = %#v, error = %v", rejected, err)
	}

	first.now = func() time.Time { return fixedNow.Add(time.Minute) }
	reset, err := first.Allow(ctx, keys, ClassAuthenticatedRead)
	if err != nil || !reset.Allowed || reset.Remaining != 119 {
		t.Fatalf("reset decision = %#v, error = %v", reset, err)
	}

	concurrentNow := fixedNow.Add(2 * time.Minute)
	first.now = func() time.Time { return concurrentNow }
	second.now = first.now
	concurrentKeys := []Key{{Scope: ScopeAccount, Value: account + "-concurrent"}, {Scope: ScopeCredential, Value: credential + "-concurrent"}}
	const attempts = 150
	start := make(chan struct{})
	results := make(chan Decision, attempts)
	errorsFound := make(chan error, attempts)
	var workers sync.WaitGroup
	for request := 0; request < attempts; request++ {
		workers.Add(1)
		go func(request int) {
			defer workers.Done()
			<-start
			limiter := first
			if request%2 == 0 {
				limiter = second
			}
			decision, err := limiter.Allow(ctx, concurrentKeys, ClassAuthenticatedRead)
			if err != nil {
				errorsFound <- err
				return
			}
			results <- decision
		}(request)
	}
	close(start)
	workers.Wait()
	close(results)
	close(errorsFound)
	for err := range errorsFound {
		t.Fatal(err)
	}
	allowed, limited := 0, 0
	for result := range results {
		if result.Allowed {
			allowed++
		} else {
			limited++
		}
	}
	if allowed != 120 || limited != attempts-120 {
		t.Fatalf("concurrent results: allowed = %d, limited = %d", allowed, limited)
	}

	for _, test := range []struct {
		name       string
		routeClass string
		limit      int
		at         time.Time
		keys       []Key
	}{
		{
			name: "authenticated writes", routeClass: ClassAuthenticatedWrite, limit: 60, at: fixedNow.Add(3 * time.Minute),
			keys: []Key{{Scope: ScopeAccount, Value: account + "-write"}, {Scope: ScopeCredential, Value: credential + "-write"}},
		},
		{
			name: "public auth", routeClass: ClassPublicAuth, limit: 20, at: fixedNow.Add(4 * time.Minute),
			keys: []Key{{Scope: ScopeIP, Value: "ip-" + account}},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			first.now = func() time.Time { return test.at }
			for request := 1; request <= test.limit; request++ {
				decision, err := first.Allow(ctx, test.keys, test.routeClass)
				if err != nil || !decision.Allowed || decision.Limit != test.limit {
					t.Fatalf("request %d decision = %#v, error = %v", request, decision, err)
				}
			}
			decision, err := first.Allow(ctx, test.keys, test.routeClass)
			if err != nil || decision.Allowed || RetryAfterSeconds(decision.RetryAfter) != 60 {
				t.Fatalf("rejected decision = %#v, error = %v", decision, err)
			}
		})
	}

	var allowedMetric, rejectedMetric int
	if err := db.QueryRow(ctx, `
		SELECT
			COALESCE(sum(request_count) FILTER (WHERE outcome = 'allowed'), 0),
			COALESCE(sum(request_count) FILTER (WHERE outcome = 'rejected'), 0)
		FROM api_rate_limit_metrics
		WHERE bucket_start IN ($1, $2, $3) AND route_class = 'authenticated_read'
	`, fixedNow.Truncate(time.Minute), fixedNow.Add(time.Minute).Truncate(time.Minute), concurrentNow.Truncate(time.Minute)).Scan(&allowedMetric, &rejectedMetric); err != nil {
		t.Fatal(err)
	}
	if allowedMetric != 241 || rejectedMetric != 31 {
		t.Fatalf("metrics = allowed %d, rejected %d", allowedMetric, rejectedMetric)
	}
	for _, test := range []struct {
		routeClass string
		at         time.Time
		allowed    int
	}{
		{routeClass: ClassAuthenticatedWrite, at: fixedNow.Add(3 * time.Minute), allowed: 60},
		{routeClass: ClassPublicAuth, at: fixedNow.Add(4 * time.Minute), allowed: 20},
	} {
		var allowed, rejected int
		if err := db.QueryRow(ctx, `
			SELECT
				COALESCE(sum(request_count) FILTER (WHERE outcome = 'allowed'), 0),
				COALESCE(sum(request_count) FILTER (WHERE outcome = 'rejected'), 0)
			FROM api_rate_limit_metrics
			WHERE bucket_start = $1 AND route_class = $2
		`, test.at.Truncate(time.Minute), test.routeClass).Scan(&allowed, &rejected); err != nil {
			t.Fatal(err)
		}
		if allowed != test.allowed || rejected != 1 {
			t.Fatalf("%s metrics = allowed %d, rejected %d", test.routeClass, allowed, rejected)
		}
	}
}

func TestRateLimitSettingsAreRuntimeDatabaseConfigurationAndExpiredStateIsRemoved(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run rate-limit integration tests")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE api_rate_limit_settings
		SET authenticated_read_limit = 7, authenticated_write_limit = 3, public_auth_limit = 2, updated_at = now()
	`); err != nil {
		t.Fatal(err)
	}
	for routeClass, want := range map[string]int{
		ClassAuthenticatedRead:  7,
		ClassAuthenticatedWrite: 3,
		ClassPublicAuth:         2,
	} {
		got, err := routeLimit(ctx, tx, routeClass)
		if err != nil || got != want {
			t.Fatalf("%s limit = %d, error = %v", routeClass, got, err)
		}
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}

	now := time.Date(1901, time.February, 1, 0, 0, 0, 0, time.UTC)
	expiredHash := hashKey(ScopeIP, fmt.Sprintf("expired-%d", time.Now().UnixNano()))
	cleanupTx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanupTx.Rollback(ctx)
	if _, err := cleanupTx.Exec(ctx, `
		INSERT INTO api_rate_limit_state (scope, key_hash, route_class, request_times, expires_at)
		VALUES ('ip', $1, 'public_auth', ARRAY[$2::timestamptz], $2)
	`, expiredHash, now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := deleteExpiredState(ctx, cleanupTx, now); err != nil {
		t.Fatal(err)
	}
	var exists bool
	if err := cleanupTx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM api_rate_limit_state WHERE key_hash = $1)", expiredHash).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("expired rate-limit state was not removed")
	}
}

func TestRateLimitTestClocksCannotShortenAWindow(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run rate-limit integration tests")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}

	base := time.Date(2200, time.January, 1, 0, 0, 0, 0, time.UTC).
		Add(time.Duration(time.Now().UnixNano()%1_000_000) * time.Minute)
	fastNow := base.Add(5 * time.Second)
	account := fmt.Sprintf("skew-account-%d", time.Now().UnixNano())
	keys := []Key{{Scope: ScopeAccount, Value: account}}
	t.Cleanup(func() {
		cleanupRateLimitTestData(t, db, keys, []time.Time{base, fastNow, base.Add(time.Minute)})
	})

	fast := NewPG(db)
	fast.cleanupExpired = false
	fast.now = func() time.Time { return fastNow }
	for request := 0; request < 120; request++ {
		decision, err := fast.Allow(ctx, keys, ClassAuthenticatedRead)
		if err != nil || !decision.Allowed {
			t.Fatalf("fast request %d = %#v, %v", request+1, decision, err)
		}
	}

	slow := NewPG(db)
	slow.cleanupExpired = false
	slow.now = func() time.Time { return base }
	decision, err := slow.Allow(ctx, keys, ClassAuthenticatedRead)
	if err != nil || decision.Allowed || RetryAfterSeconds(decision.RetryAfter) != 65 {
		t.Fatalf("slow decision = %#v, %v", decision, err)
	}

	var expiresAt time.Time
	if err := db.QueryRow(ctx, `
		SELECT expires_at FROM api_rate_limit_state
		WHERE scope = $1 AND key_hash = $2 AND route_class = $3
	`, ScopeAccount, hashKey(ScopeAccount, account), ClassAuthenticatedRead).Scan(&expiresAt); err != nil {
		t.Fatal(err)
	}
	if want := fastNow.Add(window); !expiresAt.Equal(want) {
		t.Fatalf("expires_at = %s, want %s", expiresAt, want)
	}

	slow.now = func() time.Time { return base.Add(time.Minute) }
	decision, err = slow.Allow(ctx, keys, ClassAuthenticatedRead)
	if err != nil || decision.Allowed || RetryAfterSeconds(decision.RetryAfter) != 5 {
		t.Fatalf("near-expiry decision = %#v, %v", decision, err)
	}
}

func TestNormalizedKeysAreHashedAndDeduplicated(t *testing.T) {
	raw := "session_secret_value"
	keys := normalizedKeys([]Key{{Scope: ScopeCredential, Value: raw}, {Scope: ScopeCredential, Value: raw}})
	if len(keys) != 1 || keys[0].Value == raw || len(keys[0].Value) != 64 {
		t.Fatalf("keys = %#v", keys)
	}
}

func TestRetryAfterAccountsForAConfiguredLimitReduction(t *testing.T) {
	now := time.Date(2026, time.August, 1, 12, 0, 0, 0, time.UTC)
	times := []time.Time{
		now.Add(-50 * time.Second),
		now.Add(-40 * time.Second),
		now.Add(-30 * time.Second),
		now.Add(-20 * time.Second),
	}
	if got := retryAfter(times, 2, now); got != 30*time.Second {
		t.Fatalf("retry after = %s, want 30s", got)
	}
}

func cleanupRateLimitTestData(t *testing.T, db *database.Pool, keys []Key, metricBuckets []time.Time) {
	t.Helper()
	ctx := context.Background()
	for _, key := range keys {
		if _, err := db.Exec(ctx, "DELETE FROM api_rate_limit_state WHERE scope = $1 AND key_hash = $2", key.Scope, hashKey(key.Scope, key.Value)); err != nil {
			t.Errorf("clean rate-limit state: %v", err)
		}
	}
	seen := make(map[time.Time]struct{}, len(metricBuckets))
	for _, bucket := range metricBuckets {
		bucket = bucket.Truncate(time.Minute)
		if _, ok := seen[bucket]; ok {
			continue
		}
		seen[bucket] = struct{}{}
		if _, err := db.Exec(ctx, "DELETE FROM api_rate_limit_metrics WHERE bucket_start = $1", bucket); err != nil {
			t.Errorf("clean rate-limit metrics: %v", err)
		}
	}
}
