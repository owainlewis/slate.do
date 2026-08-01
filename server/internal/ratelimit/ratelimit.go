package ratelimit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/owainlewis/slate.do/server/internal/database"
)

const (
	ScopeAccount    = "account"
	ScopeCredential = "credential"
	ScopeIP         = "ip"

	ClassAuthenticatedRead  = "authenticated_read"
	ClassAuthenticatedWrite = "authenticated_write"
	ClassPublicAuth         = "public_auth"

	OutcomeAllowed  = "allowed"
	OutcomeRejected = "rejected"
)

const window = time.Minute

type Key struct {
	Scope string
	Value string
}

type Decision struct {
	Allowed    bool
	Limit      int
	Remaining  int
	RetryAfter time.Duration
}

type Limiter interface {
	Allow(context.Context, []Key, string) (Decision, error)
}

type PG struct {
	db             *database.Pool
	now            func() time.Time
	cleanupExpired bool
}

func NewPG(db *database.Pool) *PG {
	return &PG{db: db, cleanupExpired: true}
}

func (p *PG) Allow(ctx context.Context, keys []Key, routeClass string) (Decision, error) {
	if p == nil || p.db == nil {
		return Decision{}, errors.New("rate limit database is not configured")
	}
	keys = normalizedKeys(keys)
	if len(keys) == 0 {
		return Decision{}, errors.New("rate limit key is required")
	}
	tx, err := p.db.Begin(ctx)
	if err != nil {
		return Decision{}, err
	}
	defer tx.Rollback(ctx)

	var now time.Time
	if p.now != nil {
		now = p.now().UTC()
	} else if err := tx.QueryRow(ctx, "SELECT clock_timestamp()").Scan(&now); err != nil {
		return Decision{}, err
	}
	now = now.UTC()

	limit, err := routeLimit(ctx, tx, routeClass)
	if err != nil {
		return Decision{}, err
	}
	if p.cleanupExpired {
		if err := deleteExpiredState(ctx, tx, now); err != nil {
			return Decision{}, err
		}
	}

	type state struct {
		key   Key
		times []time.Time
	}
	states := make([]state, 0, len(keys))
	cutoff := now.Add(-window)
	for _, key := range keys {
		if _, err := tx.Exec(ctx, `
			INSERT INTO api_rate_limit_state (scope, key_hash, route_class, expires_at)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT DO NOTHING
		`, key.Scope, key.Value, routeClass, now.Add(window)); err != nil {
			return Decision{}, err
		}
		var recorded []time.Time
		if err := tx.QueryRow(ctx, `
			SELECT request_times
			FROM api_rate_limit_state
			WHERE scope = $1 AND key_hash = $2 AND route_class = $3
			FOR UPDATE
		`, key.Scope, key.Value, routeClass).Scan(&recorded); err != nil {
			return Decision{}, err
		}
		active := recorded[:0]
		for _, requestTime := range recorded {
			if requestTime.After(cutoff) {
				active = append(active, requestTime)
			}
		}
		sort.Slice(active, func(i int, j int) bool { return active[i].Before(active[j]) })
		states = append(states, state{key: key, times: active})
	}

	decision := Decision{Allowed: true, Limit: limit, Remaining: limit}
	for _, current := range states {
		if remaining := limit - len(current.times); remaining < decision.Remaining {
			decision.Remaining = remaining
		}
		if len(current.times) >= limit {
			decision.Allowed = false
			retry := retryAfter(current.times, limit, now)
			if retry > decision.RetryAfter {
				decision.RetryAfter = retry
			}
		}
	}
	outcome := OutcomeRejected
	if decision.Allowed {
		outcome = OutcomeAllowed
		decision.Remaining--
		for _, current := range states {
			current.times = append(current.times, now)
			sort.Slice(current.times, func(i int, j int) bool { return current.times[i].Before(current.times[j]) })
			if _, err := tx.Exec(ctx, `
				UPDATE api_rate_limit_state
				SET request_times = $4, expires_at = $5, updated_at = $6
				WHERE scope = $1 AND key_hash = $2 AND route_class = $3
			`, current.key.Scope, current.key.Value, routeClass, current.times, expiry(current.times), now); err != nil {
				return Decision{}, err
			}
		}
	} else {
		decision.Remaining = 0
		if decision.RetryAfter <= 0 {
			decision.RetryAfter = time.Second
		}
		for _, current := range states {
			if _, err := tx.Exec(ctx, `
				UPDATE api_rate_limit_state
				SET request_times = $4, expires_at = COALESCE($5, expires_at), updated_at = $6
				WHERE scope = $1 AND key_hash = $2 AND route_class = $3
			`, current.key.Scope, current.key.Value, routeClass, current.times, expiry(current.times), now); err != nil {
				return Decision{}, err
			}
		}
	}
	if err := recordMetric(ctx, tx, now, routeClass, outcome, metricShard(keys)); err != nil {
		return Decision{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Decision{}, err
	}
	return decision, nil
}

func routeLimit(ctx context.Context, tx pgx.Tx, routeClass string) (int, error) {
	var reads, writes, public int
	if err := tx.QueryRow(ctx, `
		SELECT authenticated_read_limit, authenticated_write_limit, public_auth_limit
		FROM api_rate_limit_settings WHERE singleton = true
	`).Scan(&reads, &writes, &public); err != nil {
		return 0, err
	}
	switch routeClass {
	case ClassAuthenticatedRead:
		return reads, nil
	case ClassAuthenticatedWrite:
		return writes, nil
	case ClassPublicAuth:
		return public, nil
	default:
		return 0, errors.New("unknown rate limit route class")
	}
}

func deleteExpiredState(ctx context.Context, tx pgx.Tx, now time.Time) error {
	_, err := tx.Exec(ctx, `
		DELETE FROM api_rate_limit_state
		WHERE ctid IN (
			SELECT ctid FROM api_rate_limit_state
			WHERE expires_at <= $1
			ORDER BY expires_at
			LIMIT 100
			FOR UPDATE SKIP LOCKED
		)
	`, now)
	return err
}

func recordMetric(ctx context.Context, tx pgx.Tx, now time.Time, routeClass string, outcome string, shard int) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO api_rate_limit_metrics (bucket_start, route_class, outcome, shard, request_count)
		VALUES (date_trunc('minute', $1::timestamptz), $2, $3, $4, 1)
		ON CONFLICT (bucket_start, route_class, outcome, shard)
		DO UPDATE SET request_count = api_rate_limit_metrics.request_count + 1
	`, now, routeClass, outcome, shard)
	return err
}

func normalizedKeys(keys []Key) []Key {
	unique := make(map[Key]struct{}, len(keys))
	for _, key := range keys {
		if key.Value == "" || (key.Scope != ScopeAccount && key.Scope != ScopeCredential && key.Scope != ScopeIP) {
			continue
		}
		key.Value = hashKey(key.Scope, key.Value)
		unique[key] = struct{}{}
	}
	result := make([]Key, 0, len(unique))
	for key := range unique {
		result = append(result, key)
	}
	sort.Slice(result, func(i int, j int) bool {
		if result[i].Scope == result[j].Scope {
			return result[i].Value < result[j].Value
		}
		return result[i].Scope < result[j].Scope
	})
	return result
}

func hashKey(scope string, value string) string {
	sum := sha256.Sum256([]byte(scope + "\x00" + value))
	return hex.EncodeToString(sum[:])
}

func metricShard(keys []Key) int {
	if len(keys) == 0 || len(keys[0].Value) < 2 {
		return 0
	}
	prefix, err := strconv.ParseUint(keys[0].Value[:2], 16, 8)
	if err != nil {
		return 0
	}
	return int(prefix % 32)
}

func expiry(times []time.Time) *time.Time {
	if len(times) == 0 {
		return nil
	}
	value := times[len(times)-1].Add(window)
	return &value
}

func retryAfter(times []time.Time, limit int, now time.Time) time.Duration {
	return times[len(times)-limit].Add(window).Sub(now)
}

func RetryAfterSeconds(duration time.Duration) int {
	seconds := int(math.Ceil(duration.Seconds()))
	if seconds < 1 {
		return 1
	}
	return seconds
}
