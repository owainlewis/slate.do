package cleanup

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/owainlewis/slate.do/server/internal/database"
)

const (
	DefaultBatchSize = 500
	DefaultRowBudget = 500_000
	DefaultRunTime   = 4 * time.Minute
)

type Result struct {
	Name          string `json:"name"`
	Retention     string `json:"retention"`
	Action        string `json:"action"`
	Affected      int64  `json:"affected"`
	Batches       int    `json:"batches"`
	Backlog       *bool  `json:"backlog"`
	BudgetReached bool   `json:"budgetReached"`
	Error         string `json:"error,omitempty"`
}

type Report struct {
	StartedAt     time.Time `json:"startedAt"`
	CompletedAt   time.Time `json:"completedAt"`
	BatchSize     int       `json:"batchSize"`
	RowBudget     int       `json:"rowBudget"`
	BudgetReached bool      `json:"budgetReached"`
	TotalAffected int64     `json:"totalAffected"`
	Results       []Result  `json:"results"`
}

type rule struct {
	name      string
	retention string
	action    string
	query     string
	backlog   string
}

var rules = []rule{
	newRule("sessions", "until expires_at", "sessions", "expires_at <= $1", "expires_at"),
	newRule("password_reset_tokens_expired", "until expires_at", "password_reset_tokens", "used_at IS NULL AND expires_at <= $1", "expires_at"),
	newRule("password_reset_tokens_used", "24 hours after use", "password_reset_tokens", "used_at IS NOT NULL AND used_at <= $1::timestamptz - interval '24 hours'", "used_at"),
	newRule("password_reset_requests_processed", "24 hours after processing", "password_reset_requests", "processed_at IS NOT NULL AND processed_at <= $1::timestamptz - interval '24 hours'", "processed_at"),
	newRule("password_reset_requests_stale", "7 days while pending", "password_reset_requests", "processed_at IS NULL AND created_at <= $1::timestamptz - interval '7 days'", "created_at"),
	newRule("signup_rate_limits", "24 hours", "signup_rate_limits", "window_started_at <= $1::timestamptz - interval '24 hours'", "window_started_at"),
	newRule("password_reset_rate_limits", "24 hours", "password_reset_rate_limits", "window_started_at <= $1::timestamptz - interval '24 hours'", "window_started_at"),
	newRule("password_reset_confirmation_rate_limits", "24 hours", "password_reset_confirmation_rate_limits", "window_started_at <= $1::timestamptz - interval '24 hours'", "window_started_at"),
	newRule("api_rate_limit_state", "until expires_at", "api_rate_limit_state", "expires_at <= $1", "expires_at"),
	newRule("api_rate_limit_metrics", "30 days", "api_rate_limit_metrics", "bucket_start <= $1::timestamptz - interval '30 days'", "bucket_start"),
	newRule("task_idempotency_keys", "7 days", "task_idempotency_keys", "created_at <= $1::timestamptz - interval '7 days'", "created_at"),
	newRule("task_run_starts", "7 days", "task_run_starts", "started_at <= $1::timestamptz - interval '7 days'", "started_at"),
	newRule("agent_credential_rotations", "7 days", "agent_credential_rotations", "created_at <= $1::timestamptz - interval '7 days'", "created_at"),
	newRule("api_tokens", "revoked for 30 days", "api_tokens", "revoked_at IS NOT NULL AND revoked_at <= $1::timestamptz - interval '30 days'", "revoked_at"),
	newRule("agent_credentials", "revoked for 30 days", "agent_credentials", "revoked_at IS NOT NULL AND revoked_at <= $1::timestamptz - interval '30 days'", "revoked_at"),
}

func newRule(name, retention, table, predicate, order string) rule {
	return rule{
		name: name, retention: retention, action: "delete",
		query:   boundedDelete(table, predicate, order),
		backlog: fmt.Sprintf("SELECT EXISTS (SELECT 1 FROM %s WHERE %s)", table, predicate),
	}
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
	return RunWithBudget(ctx, db, now, batchSize, DefaultRowBudget, DefaultRunTime)
}

func RunWithBudget(ctx context.Context, db *database.Pool, now time.Time, batchSize, rowBudget int, maxRunTime time.Duration) (Report, error) {
	if batchSize < 1 || batchSize > DefaultBatchSize {
		return Report{}, fmt.Errorf("cleanup batch size must be between 1 and %d", DefaultBatchSize)
	}
	if rowBudget < 1 {
		return Report{}, errors.New("cleanup row budget must be positive")
	}
	if maxRunTime <= 0 {
		return Report{}, errors.New("cleanup run time must be positive")
	}
	report := Report{StartedAt: time.Now().UTC(), BatchSize: batchSize, RowBudget: rowBudget, Results: make([]Result, len(rules))}
	runCtx, cancel := context.WithTimeout(ctx, maxRunTime)
	defer cancel()
	var failures []error
	active := make([]bool, len(rules))
	remaining := len(rules)
	for index, item := range rules {
		report.Results[index] = Result{Name: item.name, Retention: item.retention, Action: item.action}
		active[index] = true
	}
	for remaining > 0 && runCtx.Err() == nil {
		for index, item := range rules {
			if !active[index] || runCtx.Err() != nil {
				continue
			}
			result := &report.Results[index]
			limit := batchSize
			if rowsLeft := rowBudget - int(result.Affected); rowsLeft < limit {
				limit = rowsLeft
			}
			var affected int64
			tx, beginErr := db.Begin(runCtx)
			if beginErr == nil {
				beginErr = tx.QueryRow(runCtx, item.query, now, limit).Scan(&affected)
			}
			if beginErr == nil {
				beginErr = tx.Commit(runCtx)
			} else if tx != nil {
				_ = tx.Rollback(runCtx)
			}
			if beginErr != nil {
				result.Error = beginErr.Error()
				failures = append(failures, fmt.Errorf("cleanup %s: %w", item.name, beginErr))
				active[index] = false
				remaining--
				continue
			}
			result.Batches++
			result.Affected += affected
			report.TotalAffected += affected
			if affected < int64(limit) {
				var backlog bool
				if err := db.QueryRow(runCtx, item.backlog, now).Scan(&backlog); err != nil {
					result.Error = err.Error()
					failures = append(failures, fmt.Errorf("cleanup %s backlog: %w", item.name, err))
					active[index] = false
					remaining--
					continue
				}
				result.Backlog = &backlog
				// A locked eligible row can make a SKIP LOCKED batch short. Keep
				// making progress when possible, but stop spinning when every
				// eligible row is currently locked and report the backlog.
				if !backlog || affected == 0 {
					active[index] = false
					remaining--
				}
			} else if result.Affected >= int64(rowBudget) {
				result.BudgetReached = true
				report.BudgetReached = true
				active[index] = false
				remaining--
			}
		}
	}
	if runCtx.Err() != nil {
		report.BudgetReached = true
	}
	for index, item := range rules {
		result := &report.Results[index]
		if result.Backlog != nil || result.Error != "" || runCtx.Err() != nil {
			continue
		}
		var backlog bool
		if err := db.QueryRow(runCtx, item.backlog, now).Scan(&backlog); err != nil {
			result.Error = err.Error()
			failures = append(failures, fmt.Errorf("cleanup %s backlog: %w", item.name, err))
			continue
		}
		result.Backlog = &backlog
	}
	report.CompletedAt = time.Now().UTC()
	return report, errors.Join(failures...)
}
