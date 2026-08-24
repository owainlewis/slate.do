package cleanup

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/migrations"
)

func TestCleanupRemovesOnlyExpiredOperationalDataAndIsIdempotent(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	for _, index := range []string{
		"sessions_expiry_idx", "password_reset_tokens_used_idx", "password_reset_requests_processed_idx",
		"password_reset_requests_stale_pending_idx", "signup_rate_limits_window_idx",
		"password_reset_rate_limits_window_idx", "password_reset_confirmation_rate_limits_window_idx",
		"api_rate_limit_state_expiry_idx", "api_rate_limit_metrics_pkey", "task_idempotency_keys_created_idx",
		"task_run_starts_started_idx",
		"agent_credential_rotations_created_idx", "api_tokens_revoked_idx", "agent_credentials_revoked_idx",
	} {
		var exists bool
		if err := db.QueryRow(ctx, "SELECT to_regclass($1) IS NOT NULL", index).Scan(&exists); err != nil || !exists {
			t.Fatalf("cleanup index %s exists=%v err=%v", index, exists, err)
		}
	}
	now := time.Date(2036, 8, 1, 12, 0, 0, 0, time.UTC).Add(time.Duration(time.Now().UnixNano() % int64(time.Second)))
	marker := fmt.Sprintf("cleanup-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		for _, table := range []string{"signup_rate_limits", "password_reset_rate_limits", "password_reset_confirmation_rate_limits", "api_rate_limit_state"} {
			_, _ = db.Exec(context.Background(), fmt.Sprintf("DELETE FROM %s WHERE key_hash LIKE $1", table), marker+"%")
		}
		_, _ = db.Exec(context.Background(), "DELETE FROM password_reset_requests WHERE email LIKE $1", marker+"%")
		_, _ = db.Exec(context.Background(), "DELETE FROM api_rate_limit_metrics WHERE bucket_start IN ($1::timestamptz - interval '31 days', $1::timestamptz - interval '29 days')", now)
	})
	var userID, bucketID, taskID, agentID, oldCredentialID, liveCredentialID string
	if err := db.QueryRow(ctx, `INSERT INTO users (email, password_hash) VALUES ($1, 'test') RETURNING id::text`, marker+"@slate.test").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })
	if err := db.QueryRow(ctx, `INSERT INTO buckets (user_id, name) VALUES ($1, 'Keep list') RETURNING id::text`, userID).Scan(&bucketID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `INSERT INTO tasks (bucket_id, title) VALUES ($1, 'Keep task') RETURNING id::text`, bucketID).Scan(&taskID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `INSERT INTO agents (owner_user_id, name) VALUES ($1, 'Keep agent') RETURNING id::text`, userID).Scan(&agentID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `
		INSERT INTO agent_credentials (agent_id, token_hash, revoked_at, created_at, updated_at)
		VALUES ($1, $2, $3::timestamptz - interval '31 days', $3::timestamptz - interval '40 days', $3::timestamptz - interval '31 days')
		RETURNING id::text
	`, agentID, marker+"-agent-old", now).Scan(&oldCredentialID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `
		INSERT INTO agent_credentials (agent_id, token_hash, revoked_at, created_at, updated_at)
		VALUES ($1, $2, $3::timestamptz - interval '29 days', $3::timestamptz - interval '35 days', $3::timestamptz - interval '29 days')
		RETURNING id::text
	`, agentID, marker+"-agent-live", now).Scan(&liveCredentialID); err != nil {
		t.Fatal(err)
	}

	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,$3::timestamptz - interval '1 minute'),($1,$4,$3::timestamptz + interval '1 minute')`, []any{userID, marker + "-session-old", now, marker + "-session-live"}},
		{`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used_at) VALUES ($1,$2,$3::timestamptz - interval '1 minute',NULL),($1,$4,$3::timestamptz + interval '1 hour',NULL),($1,$5,$3::timestamptz + interval '1 hour',$3::timestamptz - interval '25 hours')`, []any{userID, marker + "-reset-old", now, marker + "-reset-live", marker + "-reset-used"}},
		{`INSERT INTO password_reset_requests (email, available_at, processed_at, created_at) VALUES ($1,$4,$4::timestamptz - interval '2 days',$4::timestamptz - interval '2 days'),($2,$4::timestamptz + interval '1 day',NULL,$4::timestamptz - interval '8 days'),($3,$4::timestamptz + interval '1 day',NULL,$4)`, []any{marker + "-request-old", marker + "-request-stale", marker + "-request-live", now}},
		{`INSERT INTO signup_rate_limits (dimension,key_hash,window_started_at,attempts) VALUES ('ip',$1,$3::timestamptz - interval '25 hours',1),('ip',$2,$3::timestamptz - interval '23 hours',1)`, []any{marker + "-signup-old", marker + "-signup-live", now}},
		{`INSERT INTO password_reset_rate_limits (dimension,key_hash,window_started_at,attempts) VALUES ('ip',$1,$3::timestamptz - interval '25 hours',1),('ip',$2,$3::timestamptz - interval '23 hours',1)`, []any{marker + "-prate-old", marker + "-prate-live", now}},
		{`INSERT INTO password_reset_confirmation_rate_limits (dimension,key_hash,window_started_at,attempts) VALUES ('ip',$1,$3::timestamptz - interval '25 hours',1),('ip',$2,$3::timestamptz - interval '23 hours',1)`, []any{marker + "-confirm-old", marker + "-confirm-live", now}},
		{`INSERT INTO api_rate_limit_state (scope,key_hash,route_class,expires_at) VALUES ('ip',$1,'public_auth',$3::timestamptz - interval '1 minute'),('ip',$2,'public_auth',$3::timestamptz + interval '1 minute')`, []any{marker + "-state-old", marker + "-state-live", now}},
		{`INSERT INTO api_rate_limit_metrics (bucket_start,route_class,outcome,shard,request_count) VALUES ($1::timestamptz - interval '31 days','public_auth','allowed',0,1),($1::timestamptz - interval '29 days','public_auth','allowed',0,1)`, []any{now}},
		{`INSERT INTO task_idempotency_keys (user_id,key,request_hash,task_id,created_at) VALUES ($1,$2,'old',$4,$5::timestamptz - interval '8 days'),($1,$3,'live',$4,$5::timestamptz - interval '6 days')`, []any{userID, marker + "-task-old", marker + "-task-live", taskID, now}},
		{`INSERT INTO task_run_starts (owner_user_id,run_id,task_id,started_at) VALUES ($1,gen_random_uuid(),$2,$3::timestamptz - interval '8 days'),($1,gen_random_uuid(),$2,$3::timestamptz - interval '6 days')`, []any{userID, taskID, now}},
		{`INSERT INTO agent_credential_rotations (owner_user_id,idempotency_key,agent_id,credential_id,created_at) VALUES ($1,$2,$4,$5,$6::timestamptz - interval '8 days'),($1,$3,$4,$7,$6::timestamptz - interval '6 days')`, []any{userID, marker + "-rotation-old-0000", marker + "-rotation-live-000", agentID, oldCredentialID, now, liveCredentialID}},
		{`INSERT INTO api_tokens (user_id,name,token_hash,revoked_at,created_at) VALUES ($1,'old',$2,$4::timestamptz - interval '31 days',$4::timestamptz - interval '40 days'),($1,'live',$3,$4::timestamptz - interval '29 days',$4::timestamptz - interval '35 days')`, []any{userID, marker + "-api-old", marker + "-api-live", now}},
	}
	for _, statement := range statements {
		if _, err := db.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}

	report, err := Run(ctx, db, now, 100)
	if err != nil {
		t.Fatal(err)
	}
	if report.TotalAffected < 14 || len(report.Results) != len(rules) {
		t.Fatalf("report = %#v", report)
	}
	assertMarkerCount(t, db, "sessions", "token_hash", marker+"-session-old", 0)
	assertMarkerCount(t, db, "sessions", "token_hash", marker+"-session-live", 1)
	assertMarkerCount(t, db, "password_reset_tokens", "token_hash", marker+"-reset-old", 0)
	assertMarkerCount(t, db, "password_reset_tokens", "token_hash", marker+"-reset-live", 1)
	assertMarkerCount(t, db, "password_reset_tokens", "token_hash", marker+"-reset-used", 0)
	assertMarkerCount(t, db, "password_reset_requests", "email", marker+"-request-old", 0)
	assertMarkerCount(t, db, "password_reset_requests", "email", marker+"-request-stale", 0)
	assertMarkerCount(t, db, "password_reset_requests", "email", marker+"-request-live", 1)
	for _, item := range []struct{ table, old, live string }{
		{"signup_rate_limits", marker + "-signup-old", marker + "-signup-live"},
		{"password_reset_rate_limits", marker + "-prate-old", marker + "-prate-live"},
		{"password_reset_confirmation_rate_limits", marker + "-confirm-old", marker + "-confirm-live"},
		{"api_rate_limit_state", marker + "-state-old", marker + "-state-live"},
	} {
		assertMarkerCount(t, db, item.table, "key_hash", item.old, 0)
		assertMarkerCount(t, db, item.table, "key_hash", item.live, 1)
	}
	assertMarkerCount(t, db, "task_idempotency_keys", "key", marker+"-task-old", 0)
	assertMarkerCount(t, db, "task_idempotency_keys", "key", marker+"-task-live", 1)
	var runStarts int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM task_run_starts WHERE owner_user_id = $1 AND task_id = $2", userID, taskID).Scan(&runStarts); err != nil || runStarts != 1 {
		t.Fatalf("retained task run starts=%d want=1 err=%v", runStarts, err)
	}
	assertMarkerCount(t, db, "agent_credential_rotations", "idempotency_key", marker+"-rotation-old-0000", 0)
	assertMarkerCount(t, db, "agent_credential_rotations", "idempotency_key", marker+"-rotation-live-000", 1)
	assertMarkerCount(t, db, "api_tokens", "token_hash", marker+"-api-old", 0)
	assertMarkerCount(t, db, "api_tokens", "token_hash", marker+"-api-live", 1)
	assertMarkerCount(t, db, "agent_credentials", "token_hash", marker+"-agent-old", 0)
	assertMarkerCount(t, db, "agent_credentials", "token_hash", marker+"-agent-live", 1)

	second, err := Run(ctx, db, now, 100)
	if err != nil || second.TotalAffected != 0 {
		t.Fatalf("second run = %#v err=%v", second, err)
	}
	for _, table := range []string{"buckets", "tasks", "agents"} {
		var count int
		if err := db.QueryRow(ctx, fmt.Sprintf("SELECT count(*) FROM %s WHERE id = $1", table), map[string]string{"buckets": bucketID, "tasks": taskID, "agents": agentID}[table]).Scan(&count); err != nil || count != 1 {
			t.Fatalf("customer row %s count=%d err=%v", table, count, err)
		}
	}
}

func TestCleanupDrainsMultipleBatches(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	marker := fmt.Sprintf("cleanup-batch-%d", time.Now().UnixNano())
	var userID string
	if err := db.QueryRow(ctx, `INSERT INTO users (email,password_hash) VALUES ($1,'test') RETURNING id::text`, marker+"@slate.test").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })
	if _, err := db.Exec(ctx, `
		INSERT INTO sessions (user_id,token_hash,expires_at)
		SELECT $1, $2 || generated::text, $3::timestamptz - interval '1 hour'
		FROM generate_series(1,3) generated
	`, userID, marker, now); err != nil {
		t.Fatal(err)
	}
	report, err := RunWithBudget(ctx, db, now, 2, 10, time.Minute)
	result := resultFor(report, "sessions")
	if err != nil || result.Affected != 3 || result.Batches != 2 || backlogValue(result) {
		t.Fatalf("multi-batch run = %#v err=%v", report, err)
	}
}

func TestCleanupReportsBudgetAndResumes(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	marker := fmt.Sprintf("cleanup-budget-%d", time.Now().UnixNano())
	var userID string
	if err := db.QueryRow(ctx, `INSERT INTO users (email,password_hash) VALUES ($1,'test') RETURNING id::text`, marker+"@slate.test").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })
	if _, err := db.Exec(ctx, `
		INSERT INTO sessions (user_id,token_hash,expires_at)
		SELECT $1, $2 || generated::text, $3::timestamptz - interval '1 hour'
		FROM generate_series(1,5) generated
	`, userID, marker, now); err != nil {
		t.Fatal(err)
	}
	first, err := RunWithBudget(ctx, db, now, 2, 3, time.Minute)
	result := resultFor(first, "sessions")
	if err != nil || result.Affected != 3 || result.Batches != 2 || !backlogValue(result) || !result.BudgetReached || !first.BudgetReached {
		t.Fatalf("budgeted run = %#v err=%v", first, err)
	}
	second, err := RunWithBudget(ctx, db, now, 2, 10, time.Minute)
	result = resultFor(second, "sessions")
	if err != nil || result.Affected != 2 || backlogValue(result) || second.BudgetReached {
		t.Fatalf("resumed run = %#v err=%v", second, err)
	}
}

func TestCleanupRoundRobinDoesNotStarveLaterRules(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	marker := fmt.Sprintf("cleanup-fair-%d", time.Now().UnixNano())
	var userID string
	if err := db.QueryRow(ctx, `INSERT INTO users (email,password_hash) VALUES ($1,'test') RETURNING id::text`, marker+"@slate.test").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })
	if _, err := db.Exec(ctx, `
		INSERT INTO sessions (user_id,token_hash,expires_at)
		SELECT $1, $2 || generated::text, $3::timestamptz - interval '1 hour' FROM generate_series(1,5) generated
	`, userID, marker, now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO api_rate_limit_metrics (bucket_start,route_class,outcome,shard,request_count)
		VALUES ($1::timestamptz - interval '31 days','public_auth','allowed',31,1)
	`, now); err != nil {
		t.Fatal(err)
	}
	report, err := RunWithBudget(ctx, db, now, 1, 2, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if resultFor(report, "sessions").Affected != 2 || resultFor(report, "api_rate_limit_metrics").Affected != 1 {
		t.Fatalf("round-robin report = %#v", report)
	}
}

func TestCleanupDeadlineStopsBeforeDatabaseWork(t *testing.T) {
	db := openIntegrationDB(t)
	started := time.Now()
	report, err := RunWithBudget(context.Background(), db, time.Now().UTC(), 1, 1, time.Nanosecond)
	if err != nil {
		t.Fatal(err)
	}
	if !report.BudgetReached || time.Since(started) > time.Second {
		t.Fatalf("deadline report = %#v duration=%s", report, time.Since(started))
	}
	for _, result := range report.Results {
		if result.Backlog != nil {
			t.Fatalf("deadline claimed known backlog for %s", result.Name)
		}
	}
}

func TestCleanupReportsEligibleRowsSkippedByLocks(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	marker := fmt.Sprintf("cleanup-locked-%d", time.Now().UnixNano())
	var userID string
	if err := db.QueryRow(ctx, `INSERT INTO users (email,password_hash) VALUES ($1,'test') RETURNING id::text`, marker+"@slate.test").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })
	if _, err := db.Exec(ctx, `INSERT INTO sessions (user_id,token_hash,expires_at) VALUES ($1,$2,$3::timestamptz - interval '1 hour')`, userID, marker, now); err != nil {
		t.Fatal(err)
	}
	locker, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := locker.Exec(ctx, "SELECT 1 FROM sessions WHERE token_hash = $1 FOR UPDATE", marker); err != nil {
		t.Fatal(err)
	}
	report, err := RunWithBudget(ctx, db, now, 1, 10, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	result := resultFor(report, "sessions")
	if result.Affected != 0 || !backlogValue(result) {
		t.Fatalf("locked-row report = %#v", report)
	}
	if err := locker.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	report, err = RunWithBudget(ctx, db, now, 1, 10, time.Minute)
	if err != nil || resultFor(report, "sessions").Affected != 1 || backlogValue(resultFor(report, "sessions")) {
		t.Fatalf("unlocked-row report = %#v err=%v", report, err)
	}
}

func resultFor(report Report, name string) Result {
	for _, result := range report.Results {
		if result.Name == name {
			return result
		}
	}
	return Result{}
}

func backlogValue(result Result) bool {
	return result.Backlog != nil && *result.Backlog
}

func assertMarkerCount(t *testing.T, db *database.Pool, table string, column string, marker string, want int) {
	t.Helper()
	var count int
	if err := db.QueryRow(context.Background(), fmt.Sprintf("SELECT count(*) FROM %s WHERE %s = $1", table, column), marker).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("%s.%s marker %q count=%d want=%d", table, column, marker, count, want)
	}
}

func openIntegrationDB(t *testing.T) *database.Pool {
	t.Helper()
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run cleanup integration tests")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("cleanup_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil || (parsedURL.Scheme != "postgres" && parsedURL.Scheme != "postgresql") {
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
		t.Fatalf("SLATE_TEST_DATABASE_URL must be a PostgreSQL URL: %v", err)
	}
	query := parsedURL.Query()
	query.Set("search_path", schema+",public")
	parsedURL.RawQuery = query.Encode()
	db, err := database.Open(ctx, parsedURL.String())
	if err != nil {
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	if _, err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	return db
}
