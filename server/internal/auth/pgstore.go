package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/entitlements"
)

type PGStore struct {
	db *database.Pool
}

func NewPGStore(db *database.Pool) *PGStore {
	return &PGStore{db: db}
}

func (s *PGStore) CreateAdmin(ctx context.Context, email string, passwordHash string) (User, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx)
	var user User
	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, role)
		VALUES ($1, $2, 'admin')
		RETURNING id::text, email, role, theme
	`, email, passwordHash).Scan(&user.ID, &user.Email, &user.Role, &user.Theme)
	if uniqueViolation(err) {
		return User{}, ErrEmailTaken
	}
	if err != nil {
		return User{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO entitlements (user_id, plan, source)
		VALUES ($1, $2, $3)
	`, user.ID, entitlements.PlanPro, entitlements.SourceAdmin); err != nil {
		return User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}
	user.Entitlement = entitlements.Pro(entitlements.SourceAdmin)
	return user, nil
}

func (s *PGStore) CreateInvitedMember(ctx context.Context, email string, passwordHash string, sessionHash string, expiresAt time.Time) (User, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx)

	var user User
	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, role)
		VALUES ($1, $2, 'member')
		RETURNING id::text, email, role, theme
	`, email, passwordHash).Scan(&user.ID, &user.Email, &user.Role, &user.Theme)
	if uniqueViolation(err) {
		return User{}, ErrEmailTaken
	}
	if err != nil {
		return User{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO entitlements (user_id, plan, source)
		VALUES ($1, 'pro', 'invite_code')
	`, user.ID); err != nil {
		return User{}, err
	}

	var boardID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO boards (user_id, name, max_tasks_per_list)
		VALUES ($1, 'Today', $2)
		RETURNING id::text
	`, user.ID, entitlements.ProLimits.ActiveItemsPerList).Scan(&boardID); err != nil {
		return User{}, err
	}
	defaultLists := []struct {
		name  string
		goal  string
		inbox bool
	}{
		{"Inbox", "Capture now, organise later", true},
		{"Product", "Make the thing more useful", false},
		{"Content", "Publish work that teaches or helps", false},
		{"Growth", "Reach and serve more people", false},
		{"Operations", "Keep everything running smoothly", false},
	}
	for index, list := range defaultLists {
		if _, err := tx.Exec(ctx, `
			INSERT INTO buckets (board_id, name, goal, is_inbox, limit_count, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, boardID, list.name, list.goal, list.inbox, entitlements.ProLimits.ActiveItemsPerList, index); err != nil {
			return User{}, err
		}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, user.ID, sessionHash, expiresAt); err != nil {
		return User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}
	user.Entitlement = entitlements.Pro(entitlements.SourceInviteCode)
	return user, nil
}

func (s *PGStore) ConsumeSignupAttempt(ctx context.Context, ipHash string, emailHash string, now time.Time, window time.Duration, limit int) (time.Duration, error) {
	return s.consumeRateLimit(ctx, "signup_rate_limits", []rateLimitKey{{"ip", ipHash}, {"email", emailHash}}, now, window, limit)
}

func (s *PGStore) ConsumePasswordResetAttempt(ctx context.Context, ipHash string, emailHash string, now time.Time, window time.Duration, limit int) (time.Duration, error) {
	return s.consumeRateLimit(ctx, "password_reset_rate_limits", []rateLimitKey{{"ip", ipHash}, {"email", emailHash}}, now, window, limit)
}

func (s *PGStore) ConsumePasswordResetConfirmationAttempt(ctx context.Context, ipHash string, tokenHash string, now time.Time, window time.Duration, limit int) (time.Duration, error) {
	return s.consumeRateLimit(ctx, "password_reset_confirmation_rate_limits", []rateLimitKey{{"ip", ipHash}, {"token", tokenHash}}, now, window, limit)
}

type rateLimitKey struct {
	dimension string
	hash      string
}

func (s *PGStore) consumeRateLimit(ctx context.Context, table string, keys []rateLimitKey, now time.Time, window time.Duration, limit int) (time.Duration, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if table != "signup_rate_limits" && table != "password_reset_rate_limits" && table != "password_reset_confirmation_rate_limits" {
		return 0, fmt.Errorf("unsupported rate limit table")
	}
	if _, err := tx.Exec(ctx, "DELETE FROM "+table+" WHERE window_started_at < ($1::timestamptz - interval '24 hours')", now); err != nil {
		return 0, err
	}

	retryAfter := time.Duration(0)
	for _, key := range keys {
		var attempts int
		var started time.Time
		query := `
			INSERT INTO ` + table + ` (dimension, key_hash, window_started_at, attempts)
			VALUES ($1, $2, $3, 1)
			ON CONFLICT (dimension, key_hash) DO UPDATE SET
				window_started_at = CASE
					WHEN ` + table + `.window_started_at <= $3 - $4::interval THEN $3
					ELSE ` + table + `.window_started_at
				END,
				attempts = CASE
					WHEN ` + table + `.window_started_at <= $3 - $4::interval THEN 1
					ELSE ` + table + `.attempts + 1
				END
			RETURNING attempts, window_started_at
		`
		err := tx.QueryRow(ctx, query, key.dimension, key.hash, now, fmt.Sprintf("%f seconds", window.Seconds())).Scan(&attempts, &started)
		if err != nil {
			return 0, err
		}
		if attempts > limit {
			remaining := window - now.Sub(started)
			if remaining > retryAfter {
				retryAfter = remaining
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	if retryAfter > 0 {
		return retryAfter, ErrRateLimited
	}
	return 0, nil
}

func (s *PGStore) QueuePasswordResetRequest(ctx context.Context, email string, now time.Time) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO password_reset_requests (email, available_at)
		VALUES ($1, $2)
	`, email, now)
	return err
}

func (s *PGStore) ClaimPasswordResetRequest(ctx context.Context, now time.Time) (PasswordResetRequest, error) {
	var request PasswordResetRequest
	err := s.db.QueryRow(ctx, `
		WITH next_request AS (
			SELECT id
			FROM password_reset_requests
			WHERE processed_at IS NULL
				AND available_at <= $1
				AND (claimed_at IS NULL OR claimed_at < $1 - interval '5 minutes')
			ORDER BY available_at, created_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE password_reset_requests r
		SET claimed_at = $1, attempts = attempts + 1
		FROM next_request
		WHERE r.id = next_request.id
		RETURNING r.id::text, r.email, r.attempts
	`, now).Scan(&request.ID, &request.Email, &request.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return PasswordResetRequest{}, ErrNoPendingReset
	}
	return request, err
}

func (s *PGStore) CompletePasswordResetRequest(ctx context.Context, id string, now time.Time) error {
	_, err := s.db.Exec(ctx, `
		UPDATE password_reset_requests
		SET processed_at = $2, claimed_at = NULL
		WHERE id = $1 AND processed_at IS NULL
	`, id, now)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `
		DELETE FROM password_reset_requests
		WHERE processed_at < $1::timestamptz - interval '24 hours'
	`, now)
	return err
}

func (s *PGStore) RetryPasswordResetRequest(ctx context.Context, id string, availableAt time.Time) error {
	_, err := s.db.Exec(ctx, `
		UPDATE password_reset_requests
		SET claimed_at = NULL,
			available_at = $2,
			processed_at = CASE WHEN attempts >= 5 THEN now() ELSE NULL END
		WHERE id = $1 AND processed_at IS NULL
	`, id, availableAt)
	return err
}

func (s *PGStore) CreatePasswordResetToken(ctx context.Context, email string, tokenHash string, expiresAt time.Time) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '24 hours'"); err != nil {
		return err
	}
	var userID string
	if err := tx.QueryRow(ctx, `
		SELECT id::text FROM users
		WHERE email = $1 AND disabled_at IS NULL
		FOR UPDATE
	`, email).Scan(&userID); errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidAuth
	} else if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE password_reset_tokens
		SET used_at = now()
		WHERE user_id = $1 AND used_at IS NULL
	`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, userID, tokenHash, expiresAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *PGStore) PasswordResetTokenValid(ctx context.Context, tokenHash string, now time.Time) (bool, error) {
	var valid bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM password_reset_tokens t
			JOIN users u ON u.id = t.user_id
			WHERE t.token_hash = $1
				AND t.used_at IS NULL
				AND t.expires_at > $2
				AND u.disabled_at IS NULL
		)
	`, tokenHash, now).Scan(&valid)
	return valid, err
}

func (s *PGStore) ResetPassword(ctx context.Context, tokenHash string, passwordHash string, now time.Time) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var userID string
	if err := tx.QueryRow(ctx, `
		UPDATE password_reset_tokens
		SET used_at = $2
		WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
		RETURNING user_id::text
	`, tokenHash, now).Scan(&userID); errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidResetToken
	} else if err != nil {
		return err
	}
	result, err := tx.Exec(ctx, `
		UPDATE users
		SET password_hash = $2, updated_at = $3
		WHERE id = $1 AND disabled_at IS NULL
	`, userID, passwordHash, now)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrInvalidResetToken
	}
	if _, err := tx.Exec(ctx, "DELETE FROM sessions WHERE user_id = $1", userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE password_reset_tokens
		SET used_at = $2
		WHERE user_id = $1 AND used_at IS NULL
	`, userID, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *PGStore) FindUserByEmail(ctx context.Context, email string) (UserWithPassword, error) {
	var user UserWithPassword
	err := s.db.QueryRow(ctx, `
		SELECT u.id::text, u.email, u.role, u.theme, u.password_hash,
			COALESCE(e.plan, ''), COALESCE(e.source, '')
		FROM users u
		LEFT JOIN entitlements e ON e.user_id = u.id
		WHERE u.email = $1 AND u.disabled_at IS NULL
	`, email).Scan(&user.ID, &user.Email, &user.Role, &user.Theme, &user.PasswordHash,
		&user.Entitlement.Plan, &user.Entitlement.Source)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserWithPassword{}, ErrInvalidAuth
	}
	setEntitlementLimits(&user.User)
	return user, err
}

func (s *PGStore) FindUserBySessionHash(ctx context.Context, tokenHash string, now time.Time) (User, error) {
	var user User
	err := s.db.QueryRow(ctx, `
		SELECT u.id::text, u.email, u.role, u.theme, e.plan, e.source
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		JOIN entitlements e ON e.user_id = u.id AND e.plan = 'pro'
		WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.disabled_at IS NULL
	`, tokenHash, now).Scan(&user.ID, &user.Email, &user.Role, &user.Theme,
		&user.Entitlement.Plan, &user.Entitlement.Source)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	setEntitlementLimits(&user)
	return user, err
}

func (s *PGStore) CreateSession(ctx context.Context, userID string, expectedPasswordHash string, tokenHash string, expiresAt time.Time) error {
	tag, err := s.db.Exec(ctx, `
		WITH active_user AS (
			SELECT id FROM users
			WHERE id = $1 AND password_hash = $2 AND disabled_at IS NULL
			FOR UPDATE
		)
		INSERT INTO sessions (user_id, token_hash, expires_at)
		SELECT id, $3, $4 FROM active_user
	`, userID, expectedPasswordHash, tokenHash, expiresAt)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrUnauthorized
	}
	return err
}

func (s *PGStore) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.Exec(ctx, "DELETE FROM sessions WHERE token_hash = $1", tokenHash)
	return err
}

func (s *PGStore) ListAPITokens(ctx context.Context, userID string) ([]APIToken, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, name, last_used_at, created_at
		FROM api_tokens
		WHERE user_id = $1 AND revoked_at IS NULL
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tokens []APIToken
	for rows.Next() {
		var token APIToken
		if err := rows.Scan(&token.ID, &token.Name, &token.LastUsedAt, &token.CreatedAt); err != nil {
			return nil, err
		}
		tokens = append(tokens, token)
	}
	return tokens, rows.Err()
}

func (s *PGStore) CreateAPIToken(ctx context.Context, userID string, name string, tokenHash string) (APIToken, error) {
	var token APIToken
	err := s.db.QueryRow(ctx, `
		WITH active_user AS (
			SELECT id FROM users
			WHERE id = $1 AND disabled_at IS NULL
			FOR UPDATE
		)
		INSERT INTO api_tokens (user_id, name, token_hash)
		SELECT id, $2, $3 FROM active_user
		RETURNING id::text, name, last_used_at, created_at
	`, userID, name, tokenHash).Scan(&token.ID, &token.Name, &token.LastUsedAt, &token.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return APIToken{}, ErrUnauthorized
	}
	return token, err
}

func (s *PGStore) RevokeAPIToken(ctx context.Context, userID string, id string) error {
	_, err := s.db.Exec(ctx, `
		UPDATE api_tokens
		SET revoked_at = now()
		WHERE user_id = $1 AND id = $2 AND revoked_at IS NULL
	`, userID, id)
	return err
}

func (s *PGStore) FindUserByAPITokenHash(ctx context.Context, tokenHash string, now time.Time) (User, error) {
	var user User
	err := s.db.QueryRow(ctx, `
		UPDATE api_tokens t
		SET last_used_at = $2
		FROM users u, entitlements e
		WHERE t.user_id = u.id AND e.user_id = u.id AND e.plan = 'pro'
			AND u.disabled_at IS NULL
			AND t.token_hash = $1 AND t.revoked_at IS NULL
		RETURNING u.id::text, u.email, u.role, u.theme, e.plan, e.source
	`, tokenHash, now).Scan(&user.ID, &user.Email, &user.Role, &user.Theme,
		&user.Entitlement.Plan, &user.Entitlement.Source)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	setEntitlementLimits(&user)
	return user, err
}

func (s *PGStore) UpdateTheme(ctx context.Context, userID string, theme string) (User, error) {
	var user User
	err := s.db.QueryRow(ctx, `
		UPDATE users u
		SET theme = $2, updated_at = now()
		FROM entitlements e
		WHERE u.id = $1 AND e.user_id = u.id AND e.plan = 'pro' AND u.disabled_at IS NULL
		RETURNING u.id::text, u.email, u.role, u.theme, e.plan, e.source
	`, userID, theme).Scan(&user.ID, &user.Email, &user.Role, &user.Theme,
		&user.Entitlement.Plan, &user.Entitlement.Source)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	setEntitlementLimits(&user)
	return user, err
}

func (s *PGStore) ListMembers(ctx context.Context) ([]MemberAccount, error) {
	rows, err := s.db.Query(ctx, `
		SELECT email, disabled_at, created_at
		FROM users
		WHERE role = 'member'
		ORDER BY email
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var accounts []MemberAccount
	for rows.Next() {
		var account MemberAccount
		if err := rows.Scan(&account.Email, &account.DisabledAt, &account.CreatedAt); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

func (s *PGStore) SetMemberDisabled(ctx context.Context, email string, disabled bool) error {
	email = normalizeEmail(email)
	if email == "" {
		return ErrMemberNotFound
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var userID string
	value := "NULL"
	if disabled {
		value = "now()"
	}
	query := `UPDATE users SET disabled_at = ` + value + `, updated_at = now()
		WHERE email = $1 AND role = 'member' RETURNING id::text`
	if err := tx.QueryRow(ctx, query, email).Scan(&userID); errors.Is(err, pgx.ErrNoRows) {
		return ErrMemberNotFound
	} else if err != nil {
		return err
	}
	if disabled {
		if _, err := tx.Exec(ctx, "DELETE FROM sessions WHERE user_id = $1", userID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "UPDATE api_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", userID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func setEntitlementLimits(user *User) {
	if user.Entitlement.Plan == entitlements.PlanPro {
		user.Entitlement.Limits = entitlements.ProLimits
	}
}

func uniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
