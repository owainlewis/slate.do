package cleanup

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/owainlewis/slate.do/server/internal/database"
)

const DefaultBatchSize = 500

type Result struct {
	Name      string `json:"name"`
	Retention string `json:"retention"`
	Action    string `json:"action"`
	Affected  int64  `json:"affected"`
	Error     string `json:"error,omitempty"`
}

type Report struct {
	StartedAt     time.Time `json:"startedAt"`
	CompletedAt   time.Time `json:"completedAt"`
	BatchSize     int       `json:"batchSize"`
	TotalAffected int64     `json:"totalAffected"`
	Results       []Result  `json:"results"`
}

type rule struct {
	name      string
	retention string
	action    string
	query     string
}

var rules = []rule{
	{"sessions", "until expires_at", "delete", boundedDelete("sessions", "expires_at <= $1", "expires_at")},
	{"password_reset_tokens_expired", "until expires_at", "delete", boundedDelete("password_reset_tokens", "used_at IS NULL AND expires_at <= $1", "expires_at")},
	{"password_reset_tokens_used", "24 hours after use", "delete", boundedDelete("password_reset_tokens", "used_at IS NOT NULL AND used_at <= $1::timestamptz - interval '24 hours'", "used_at")},
	{"password_reset_requests_processed", "24 hours after processing", "delete", boundedDelete("password_reset_requests", "processed_at IS NOT NULL AND processed_at <= $1::timestamptz - interval '24 hours'", "processed_at")},
	{"password_reset_requests_stale", "7 days while pending", "delete", boundedDelete("password_reset_requests", "processed_at IS NULL AND created_at <= $1::timestamptz - interval '7 days'", "created_at")},
	{"signup_rate_limits", "24 hours", "delete", boundedDelete("signup_rate_limits", "window_started_at <= $1::timestamptz - interval '24 hours'", "window_started_at")},
	{"password_reset_rate_limits", "24 hours", "delete", boundedDelete("password_reset_rate_limits", "window_started_at <= $1::timestamptz - interval '24 hours'", "window_started_at")},
	{"password_reset_confirmation_rate_limits", "24 hours", "delete", boundedDelete("password_reset_confirmation_rate_limits", "window_started_at <= $1::timestamptz - interval '24 hours'", "window_started_at")},
	{"api_rate_limit_state", "until expires_at", "delete", boundedDelete("api_rate_limit_state", "expires_at <= $1", "expires_at")},
	{"api_rate_limit_metrics", "30 days", "delete", boundedDelete("api_rate_limit_metrics", "bucket_start <= $1::timestamptz - interval '30 days'", "bucket_start")},
	{"task_idempotency_keys", "7 days", "delete", boundedDelete("task_idempotency_keys", "created_at <= $1::timestamptz - interval '7 days'", "created_at")},
	{"agent_credential_rotations", "7 days", "delete", boundedDelete("agent_credential_rotations", "created_at <= $1::timestamptz - interval '7 days'", "created_at")},
	{"api_tokens", "revoked for 30 days", "delete", boundedDelete("api_tokens", "revoked_at IS NOT NULL AND revoked_at <= $1::timestamptz - interval '30 days'", "revoked_at")},
	{"agent_credentials", "revoked for 30 days", "delete", boundedDelete("agent_credentials", "revoked_at IS NOT NULL AND revoked_at <= $1::timestamptz - interval '30 days'", "revoked_at")},
}

func boundedDelete(table string, predicate string, order string) string {
	return fmt.Sprintf(`
		WITH doomed AS (
			SELECT ctid FROM %s
			WHERE %s
			ORDER BY %s
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		), deleted AS (
			DELETE FROM %s WHERE ctid IN (SELECT ctid FROM doomed)
			RETURNING 1
		)
		SELECT count(*) FROM deleted
	`, table, predicate, order, table)
}

func Run(ctx context.Context, db *database.Pool, now time.Time, batchSize int) (Report, error) {
	if batchSize < 1 || batchSize > 10_000 {
		return Report{}, fmt.Errorf("cleanup batch size must be between 1 and 10000")
	}
	report := Report{StartedAt: time.Now().UTC(), BatchSize: batchSize, Results: make([]Result, 0, len(rules))}
	var failures []error
	for _, item := range rules {
		result := Result{Name: item.name, Retention: item.retention, Action: item.action}
		tx, err := db.Begin(ctx)
		if err == nil {
			err = tx.QueryRow(ctx, item.query, now, batchSize).Scan(&result.Affected)
		}
		if err == nil {
			err = tx.Commit(ctx)
		} else if tx != nil {
			_ = tx.Rollback(ctx)
		}
		if err != nil {
			result.Error = err.Error()
			failures = append(failures, fmt.Errorf("cleanup %s: %w", item.name, err))
		} else {
			report.TotalAffected += result.Affected
		}
		report.Results = append(report.Results, result)
	}
	report.CompletedAt = time.Now().UTC()
	return report, errors.Join(failures...)
}
