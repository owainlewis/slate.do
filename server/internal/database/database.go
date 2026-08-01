package database

import (
	"context"
	"errors"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrCapacity = errors.New("database application connection capacity is unavailable")

const advisoryLockNamespace int32 = 1397506388

type Options struct {
	MaxConnections          int32
	AcquireTimeout          time.Duration
	StatementTimeout        time.Duration
	IdleTransactionTimeout  time.Duration
	MaxConnectionIdleTime   time.Duration
	MaxConnectionLifetime   time.Duration
	ConnectionLimit         int
	ConnectionLockNamespace int32
}

type Pool struct {
	*pgxpool.Pool
	options Options
}

func Open(ctx context.Context, databaseURL string, supplied ...Options) (*Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	options := defaultOptions()
	if len(supplied) > 0 {
		options = supplied[0]
	}
	cfg.MaxConns = options.MaxConnections
	cfg.MaxConnIdleTime = options.MaxConnectionIdleTime
	cfg.MaxConnLifetime = options.MaxConnectionLifetime
	cfg.ConnConfig.ConnectTimeout = options.AcquireTimeout
	cfg.ConnConfig.RuntimeParams["statement_timeout"] = milliseconds(options.StatementTimeout)
	cfg.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = milliseconds(options.IdleTransactionTimeout)
	if options.ConnectionLimit > 0 {
		lockNamespace := options.ConnectionLockNamespace
		if lockNamespace == 0 {
			lockNamespace = advisoryLockNamespace
		}
		previousAfterConnect := cfg.AfterConnect
		cfg.AfterConnect = func(ctx context.Context, connection *pgx.Conn) error {
			if previousAfterConnect != nil {
				if err := previousAfterConnect(ctx, connection); err != nil {
					return err
				}
			}
			var slot int
			err := connection.QueryRow(ctx, `
				SELECT slot
				FROM generate_series(0, $2::integer - 1) AS slot
				WHERE pg_try_advisory_lock($1, slot::integer)
				LIMIT 1
			`, lockNamespace, options.ConnectionLimit).Scan(&slot)
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrCapacity
			}
			return err
		}
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	result := &Pool{Pool: pool, options: options}
	if err := result.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return result, nil
}

func (p *Pool) MaxConnections() int32 {
	return p.options.MaxConnections
}

func (p *Pool) AcquireTimeout() time.Duration {
	return p.options.AcquireTimeout
}

func (p *Pool) ConnectionLimit() int {
	return p.options.ConnectionLimit
}

func (p *Pool) ServerCapacity(ctx context.Context) (int, int, error) {
	var maximum, current int
	err := p.QueryRow(ctx, `
		SELECT current_setting('max_connections')::integer,
		       (SELECT count(*)::integer FROM pg_stat_activity)
	`).Scan(&maximum, &current)
	return maximum, current, err
}

func IsCapacityError(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, ErrCapacity) {
		return true
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return true
	}
	var postgresError *pgconn.PgError
	if !errors.As(err, &postgresError) {
		return false
	}
	if len(postgresError.Code) >= 2 && (postgresError.Code[:2] == "08" || postgresError.Code[:2] == "53") {
		return true
	}
	switch postgresError.Code {
	case "25P03", "57014", "57P01", "57P02", "57P03", "57P05":
		return true
	default:
		return false
	}
}

func (p *Pool) Begin(ctx context.Context) (pgx.Tx, error) {
	connection, err := p.acquire(ctx)
	if err != nil {
		return nil, err
	}
	tx, err := connection.Begin(ctx)
	if err != nil {
		connection.Release()
		return nil, err
	}
	return &poolTx{Tx: tx, connection: connection}, nil
}

func (p *Pool) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	connection, err := p.acquire(ctx)
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	defer connection.Release()
	return connection.Exec(ctx, sql, arguments...)
}

func (p *Pool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	connection, err := p.acquire(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := connection.Query(ctx, sql, args...)
	if err != nil {
		connection.Release()
		return nil, err
	}
	return &releaseRows{Rows: rows, release: once(connection.Release)}, nil
}

func (p *Pool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	connection, err := p.acquire(ctx)
	if err != nil {
		return errorRow{err: err}
	}
	return releaseRow{Row: connection.QueryRow(ctx, sql, args...), release: once(connection.Release)}
}

func (p *Pool) Ping(ctx context.Context) error {
	connection, err := p.acquire(ctx)
	if err != nil {
		return err
	}
	defer connection.Release()
	return connection.Ping(ctx)
}

func (p *Pool) acquire(ctx context.Context) (*pgxpool.Conn, error) {
	if p.options.AcquireTimeout <= 0 {
		return p.Pool.Acquire(ctx)
	}
	acquireCtx, cancel := context.WithTimeout(ctx, p.options.AcquireTimeout)
	defer cancel()
	return p.Pool.Acquire(acquireCtx)
}

type errorRow struct {
	err error
}

func (r errorRow) Scan(...any) error {
	return r.err
}

type releaseRow struct {
	pgx.Row
	release func()
}

func (r releaseRow) Scan(dest ...any) error {
	defer r.release()
	return r.Row.Scan(dest...)
}

type releaseRows struct {
	pgx.Rows
	release func()
}

func (r *releaseRows) Next() bool {
	next := r.Rows.Next()
	if !next {
		r.release()
	}
	return next
}

func (r *releaseRows) Close() {
	r.Rows.Close()
	r.release()
}

type poolTx struct {
	pgx.Tx
	connection *pgxpool.Conn
	release    sync.Once
}

func (t *poolTx) Commit(ctx context.Context) error {
	err := t.Tx.Commit(ctx)
	t.release.Do(t.connection.Release)
	return err
}

func (t *poolTx) Rollback(ctx context.Context) error {
	err := t.Tx.Rollback(ctx)
	t.release.Do(t.connection.Release)
	return err
}

func defaultOptions() Options {
	return Options{
		MaxConnections:         4,
		AcquireTimeout:         2 * time.Second,
		StatementTimeout:       10 * time.Second,
		IdleTransactionTimeout: 10 * time.Second,
		MaxConnectionIdleTime:  5 * time.Minute,
		MaxConnectionLifetime:  30 * time.Minute,
	}
}

func milliseconds(duration time.Duration) string {
	return strconv.FormatInt(duration.Milliseconds(), 10)
}

func once(release func()) func() {
	var guard sync.Once
	return func() {
		guard.Do(release)
	}
}
