package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
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
		INSERT INTO users (email, password_hash, role, display_name)
		VALUES ($1, $2, 'admin', split_part($1, '@', 1))
		RETURNING id::text, email, role, theme, display_name
	`, email, passwordHash).Scan(&user.ID, &user.Email, &user.Role, &user.Theme, &user.DisplayName)
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
		INSERT INTO users (email, password_hash, role, display_name)
		VALUES ($1, $2, 'member', split_part($1, '@', 1))
		RETURNING id::text, email, role, theme, display_name
	`, email, passwordHash).Scan(&user.ID, &user.Email, &user.Role, &user.Theme, &user.DisplayName)
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
		SELECT u.id::text, u.email, u.role, u.theme, u.display_name, u.password_hash,
			COALESCE(e.plan, ''), COALESCE(e.source, '')
		FROM users u
		LEFT JOIN entitlements e ON e.user_id = u.id
		WHERE u.email = $1 AND u.disabled_at IS NULL
	`, email).Scan(&user.ID, &user.Email, &user.Role, &user.Theme, &user.DisplayName, &user.PasswordHash,
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
		SELECT u.id::text, u.email, u.role, u.theme, u.display_name, e.plan, e.source
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		JOIN entitlements e ON e.user_id = u.id AND e.plan = 'pro'
		WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.disabled_at IS NULL
	`, tokenHash, now).Scan(&user.ID, &user.Email, &user.Role, &user.Theme, &user.DisplayName,
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
		WITH human_token AS (
			UPDATE api_tokens t
			SET last_used_at = $2
			FROM users u, entitlements e
			WHERE t.user_id = u.id AND e.user_id = u.id AND e.plan = 'pro'
				AND u.disabled_at IS NULL
				AND t.token_hash = $1 AND t.revoked_at IS NULL
			RETURNING u.id, u.email, u.role, u.theme, u.display_name, e.plan, e.source
		), agent_token AS (
			UPDATE agent_credentials c
			SET last_used_at = $2, updated_at = $2
			FROM agents a, users u, entitlements e
			WHERE c.agent_id = a.id
				AND a.owner_user_id = u.id AND e.user_id = u.id AND e.plan = 'pro'
				AND u.disabled_at IS NULL
				AND c.token_hash = $1 AND c.revoked_at IS NULL AND a.archived_at IS NULL
			RETURNING u.id, u.theme, a.id AS agent_id, a.name AS display_name, e.plan, e.source
		)
		SELECT id::text, email, role, theme, display_name, '' AS agent_id, plan, source
		FROM human_token
		UNION ALL
		SELECT id::text, '', 'agent', theme, display_name, agent_id::text, plan, source
		FROM agent_token
		LIMIT 1
	`, tokenHash, now).Scan(&user.ID, &user.Email, &user.Role, &user.Theme, &user.DisplayName, &user.AgentID,
		&user.Entitlement.Plan, &user.Entitlement.Source)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	setEntitlementLimits(&user)
	return user, err
}

func (s *PGStore) UpdateTheme(ctx context.Context, userID string, theme string) (User, error) {
	return s.UpdateProfile(ctx, userID, &theme, nil)
}

func (s *PGStore) UpdateProfile(ctx context.Context, userID string, theme *string, displayName *string) (User, error) {
	var user User
	err := s.db.QueryRow(ctx, `
		UPDATE users u
		SET theme = CASE WHEN $2 THEN $3 ELSE u.theme END,
			display_name = CASE WHEN $4 THEN $5 ELSE u.display_name END,
			updated_at = now()
		FROM entitlements e
		WHERE u.id = $1 AND e.user_id = u.id AND e.plan = 'pro' AND u.disabled_at IS NULL
		RETURNING u.id::text, u.email, u.role, u.theme, u.display_name, e.plan, e.source
	`, userID, theme != nil, stringValue(theme), displayName != nil, stringValue(displayName)).Scan(
		&user.ID, &user.Email, &user.Role, &user.Theme, &user.DisplayName,
		&user.Entitlement.Plan, &user.Entitlement.Source)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	setEntitlementLimits(&user)
	return user, err
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s *PGStore) ListAgents(ctx context.Context, userID string) ([]AgentUser, error) {
	rows, err := s.db.Query(ctx, `
		SELECT a.id::text, a.name, COALESCE(a.purpose, ''), a.archived_at, a.created_at, a.updated_at,
			c.id::text, COALESCE(c.token_prefix, ''), c.last_used_at, c.revoked_at, c.created_at, c.updated_at,
			COALESCE(work.ready, 0), COALESCE(work.working, 0), COALESCE(work.review, 0)
		FROM agents a
		LEFT JOIN LATERAL (
			SELECT id, token_prefix, last_used_at, revoked_at, created_at, updated_at
			FROM agent_credentials
			WHERE agent_id = a.id
			ORDER BY revoked_at NULLS FIRST, created_at DESC
			LIMIT 1
		) c ON true
		LEFT JOIN LATERAL (
			SELECT
				count(*) FILTER (WHERE t.status = 'queued' AND NOT t.done) AS ready,
				count(*) FILTER (WHERE t.status = 'working' AND NOT t.done) AS working,
				count(*) FILTER (WHERE t.status = 'needs_review' AND NOT t.done) AS review
			FROM tasks t
			JOIN boards b ON b.id = t.board_id AND b.user_id = a.owner_user_id
			WHERE t.assignee_agent_id = a.id
		) work ON true
		WHERE a.owner_user_id = $1
		ORDER BY a.archived_at NULLS FIRST, lower(a.name), a.created_at
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var agents []AgentUser
	for rows.Next() {
		agent, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		agents = append(agents, agent)
	}
	return agents, rows.Err()
}

func (s *PGStore) GetAgent(ctx context.Context, userID string, agentID string) (AgentUser, error) {
	row := s.db.QueryRow(ctx, `
		SELECT a.id::text, a.name, COALESCE(a.purpose, ''), a.archived_at, a.created_at, a.updated_at,
			c.id::text, COALESCE(c.token_prefix, ''), c.last_used_at, c.revoked_at, c.created_at, c.updated_at,
			COALESCE(work.ready, 0), COALESCE(work.working, 0), COALESCE(work.review, 0)
		FROM agents a
		LEFT JOIN LATERAL (
			SELECT id, token_prefix, last_used_at, revoked_at, created_at, updated_at
			FROM agent_credentials
			WHERE agent_id = a.id
			ORDER BY revoked_at NULLS FIRST, created_at DESC
			LIMIT 1
		) c ON true
		LEFT JOIN LATERAL (
			SELECT
				count(*) FILTER (WHERE t.status = 'queued' AND NOT t.done) AS ready,
				count(*) FILTER (WHERE t.status = 'working' AND NOT t.done) AS working,
				count(*) FILTER (WHERE t.status = 'needs_review' AND NOT t.done) AS review
			FROM tasks t
			JOIN boards b ON b.id = t.board_id AND b.user_id = a.owner_user_id
			WHERE t.assignee_agent_id = a.id
		) work ON true
		WHERE a.owner_user_id = $1 AND a.id::text = $2
	`, userID, agentID)
	agent, err := scanAgent(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return AgentUser{}, ErrAgentNotFound
	}
	return agent, err
}

func (s *PGStore) CreateAgent(ctx context.Context, userID string, displayName string, purpose string, tokenHash string, tokenPrefix string) (AgentUser, error) {
	displayName = strings.TrimSpace(displayName)
	purpose = strings.TrimSpace(purpose)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return AgentUser{}, err
	}
	defer tx.Rollback(ctx)

	var activeUserID string
	err = tx.QueryRow(ctx, `
		SELECT u.id::text
		FROM users u
		JOIN entitlements e ON e.user_id = u.id AND e.plan = 'pro'
		WHERE u.id = $1 AND u.disabled_at IS NULL
		FOR UPDATE OF u
	`, userID).Scan(&activeUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return AgentUser{}, ErrUnauthorized
	}
	if err != nil {
		return AgentUser{}, err
	}
	var activeAgents int
	if err := tx.QueryRow(ctx, `
		SELECT count(*)
		FROM agents
		WHERE owner_user_id = $1 AND archived_at IS NULL
	`, activeUserID).Scan(&activeAgents); err != nil {
		return AgentUser{}, err
	}
	if activeAgents >= entitlements.ProLimits.Agents {
		return AgentUser{}, ErrAgentLimit
	}

	var agent AgentUser
	err = tx.QueryRow(ctx, `
		INSERT INTO agents (owner_user_id, name, purpose)
		VALUES ($1, $2, NULLIF($3, ''))
		RETURNING id::text, name, COALESCE(purpose, ''), archived_at, created_at, updated_at
	`, activeUserID, displayName, purpose).Scan(
		&agent.ID, &agent.DisplayName, &agent.Purpose, &agent.ArchivedAt, &agent.CreatedAt, &agent.UpdatedAt,
	)
	if constraintViolation(err, "agents_owner_active_name_idx") {
		return AgentUser{}, ErrAgentNameTaken
	}
	if err != nil {
		return AgentUser{}, err
	}
	var credential AgentCredential
	err = tx.QueryRow(ctx, `
		INSERT INTO agent_credentials (agent_id, token_hash, token_prefix)
		VALUES ($1, $2, $3)
		RETURNING id::text, COALESCE(token_prefix, ''), last_used_at, revoked_at, created_at, updated_at
	`, agent.ID, tokenHash, tokenPrefix).Scan(
		&credential.ID, &credential.TokenPrefix, &credential.LastUsedAt, &credential.RevokedAt, &credential.CreatedAt, &credential.UpdatedAt,
	)
	if err != nil {
		return AgentUser{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AgentUser{}, err
	}
	agent.Credential = &credential
	agent.LastUsedAt = credential.LastUsedAt
	agent.RevokedAt = credential.RevokedAt
	return agent, nil
}

func (s *PGStore) RevokeAgentToken(ctx context.Context, userID string, agentID string) error {
	var found bool
	err := s.db.QueryRow(ctx, `
		WITH owned_agent AS (
			SELECT id
			FROM agents
			WHERE owner_user_id = $1 AND id = $2 AND archived_at IS NULL
		), revoked AS (
			UPDATE agent_credentials c
			SET revoked_at = COALESCE(c.revoked_at, now()), updated_at = now()
			FROM owned_agent a
			WHERE c.agent_id = a.id
			RETURNING c.id
		)
		SELECT EXISTS (SELECT 1 FROM owned_agent)
	`, userID, agentID).Scan(&found)
	if err == nil && !found {
		return ErrAgentNotFound
	}
	return err
}

func (s *PGStore) DeleteAgent(ctx context.Context, userID string, agentID string) error {
	var found bool
	err := s.db.QueryRow(ctx, `
		WITH archived AS (
			UPDATE agents
			SET archived_at = now(), updated_at = now()
			WHERE owner_user_id = $1 AND id = $2 AND archived_at IS NULL
			RETURNING id
		), revoked AS (
			UPDATE agent_credentials c
			SET revoked_at = COALESCE(c.revoked_at, now()), updated_at = now()
			FROM archived a
			WHERE c.agent_id = a.id
			RETURNING c.id
		)
		SELECT EXISTS (SELECT 1 FROM archived)
	`, userID, agentID).Scan(&found)
	if err == nil && !found {
		return ErrAgentNotFound
	}
	return err
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
		if _, err := tx.Exec(ctx, `
			UPDATE agent_credentials c
			SET revoked_at = now(), updated_at = now()
			FROM agents a
			WHERE c.agent_id = a.id
				AND a.owner_user_id = $1
				AND c.revoked_at IS NULL
		`, userID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

type rowScanner interface {
	Scan(...any) error
}

func scanAgent(row rowScanner) (AgentUser, error) {
	var agent AgentUser
	var credentialID *string
	var credentialPrefix *string
	var credentialLastUsedAt *time.Time
	var credentialRevokedAt *time.Time
	var credentialCreatedAt *time.Time
	var credentialUpdatedAt *time.Time
	err := row.Scan(
		&agent.ID,
		&agent.DisplayName,
		&agent.Purpose,
		&agent.ArchivedAt,
		&agent.CreatedAt,
		&agent.UpdatedAt,
		&credentialID,
		&credentialPrefix,
		&credentialLastUsedAt,
		&credentialRevokedAt,
		&credentialCreatedAt,
		&credentialUpdatedAt,
		&agent.WorkCounts.Ready,
		&agent.WorkCounts.Working,
		&agent.WorkCounts.Review,
	)
	if err != nil {
		return AgentUser{}, err
	}
	agent.DeletedAt = agent.ArchivedAt
	if credentialID != nil && credentialCreatedAt != nil && credentialUpdatedAt != nil {
		credential := AgentCredential{
			ID:         *credentialID,
			LastUsedAt: credentialLastUsedAt,
			RevokedAt:  credentialRevokedAt,
			CreatedAt:  *credentialCreatedAt,
			UpdatedAt:  *credentialUpdatedAt,
		}
		if credentialPrefix != nil {
			credential.TokenPrefix = *credentialPrefix
		}
		agent.Credential = &credential
		agent.LastUsedAt = credential.LastUsedAt
		agent.RevokedAt = credential.RevokedAt
	}
	return agent, nil
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

func constraintViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}
