package auth

import (
	"context"
	"errors"
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
func (s *PGStore) FindUserByEmail(ctx context.Context, email string) (UserWithPassword, error) {
	var user UserWithPassword
	err := s.db.QueryRow(ctx, `
		SELECT u.id::text, u.email, u.role, u.theme, u.password_hash,
			COALESCE(e.plan, ''), COALESCE(e.source, '')
		FROM users u
		LEFT JOIN entitlements e ON e.user_id = u.id
		WHERE u.email = $1
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
		WHERE s.token_hash = $1 AND s.expires_at > $2
	`, tokenHash, now).Scan(&user.ID, &user.Email, &user.Role, &user.Theme,
		&user.Entitlement.Plan, &user.Entitlement.Source)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	setEntitlementLimits(&user)
	return user, err
}

func (s *PGStore) CreateSession(ctx context.Context, userID string, tokenHash string, expiresAt time.Time) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, userID, tokenHash, expiresAt)
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
		INSERT INTO api_tokens (user_id, name, token_hash)
		VALUES ($1, $2, $3)
		RETURNING id::text, name, last_used_at, created_at
	`, userID, name, tokenHash).Scan(&token.ID, &token.Name, &token.LastUsedAt, &token.CreatedAt)
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
		WHERE u.id = $1 AND e.user_id = u.id AND e.plan = 'pro'
		RETURNING u.id::text, u.email, u.role, u.theme, e.plan, e.source
	`, userID, theme).Scan(&user.ID, &user.Email, &user.Role, &user.Theme,
		&user.Entitlement.Plan, &user.Entitlement.Source)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	setEntitlementLimits(&user)
	return user, err
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
