package agents

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/entitlements"
)

var (
	ErrArchiveConflict       = errors.New("agent has open assigned work")
	ErrDeleteRequiresArchive = errors.New("agent must be archived before deletion")
	ErrIdempotencyConflict   = errors.New("idempotency key belongs to another agent")
	ErrRestoreLimit          = errors.New("active agent limit reached")
	ErrRestoreNameTaken      = errors.New("active agent name already exists")
)

type ArchiveConflictError struct {
	Counts ArchiveConflict
}

func (e *ArchiveConflictError) Error() string { return ErrArchiveConflict.Error() }
func (e *ArchiveConflictError) Unwrap() error { return ErrArchiveConflict }

type agentFinder interface {
	GetAgent(context.Context, string, string) (auth.AgentUser, error)
}

type Store struct {
	db     *database.Pool
	agents agentFinder
}

func NewStore(db *database.Pool, agentStore agentFinder) *Store {
	return &Store{db: db, agents: agentStore}
}

func (s *Store) GetDetail(ctx context.Context, userID string, agentID string) (Detail, error) {
	agent, err := s.agents.GetAgent(ctx, userID, agentID)
	if err != nil {
		return Detail{}, err
	}
	totals, err := s.workTotals(ctx, userID, agentID)
	if err != nil {
		return Detail{}, err
	}
	open, err := s.listInitialOpen(ctx, userID, agentID)
	if err != nil {
		return Detail{}, err
	}
	completed, err := s.listRecentlyCompleted(ctx, userID, agentID)
	if err != nil {
		return Detail{}, err
	}
	work := AssignedWork{
		Ready:             []WorkItem{},
		Working:           []WorkItem{},
		Review:            []WorkItem{},
		RecentlyCompleted: completed,
		Totals:            totals,
		OpenLimit:         InitialOpenLimit,
		CompletedLimit:    InitialCompletedLimit,
	}
	for _, item := range open {
		switch item.Status {
		case "queued":
			work.Ready = append(work.Ready, item)
		case "working":
			work.Working = append(work.Working, item)
		case "needs_review":
			work.Review = append(work.Review, item)
		}
	}
	return Detail{Agent: agent, Work: work}, nil
}

func (s *Store) ListWork(ctx context.Context, userID string, agentID string, page int, pageSize int) (WorkPage, error) {
	if _, err := s.agents.GetAgent(ctx, userID, agentID); err != nil {
		return WorkPage{}, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}
	var total int
	if err := s.db.QueryRow(ctx, `
		SELECT count(*)
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		WHERE b.user_id = $1 AND t.assignee_agent_id = $2 AND t.kind = 'action'
	`, userID, agentID).Scan(&total); err != nil {
		return WorkPage{}, err
	}
	offset := (page - 1) * pageSize
	rows, err := s.db.Query(ctx, workSelect+`
		WHERE b.user_id = $1 AND t.assignee_agent_id = $2 AND t.kind = 'action'
		ORDER BY t.updated_at DESC, t.id
		LIMIT $3 OFFSET $4
	`, userID, agentID, pageSize, offset)
	if err != nil {
		return WorkPage{}, err
	}
	items, err := scanWorkItems(rows)
	if err != nil {
		return WorkPage{}, err
	}
	return WorkPage{
		Items:       items,
		Page:        page,
		PageSize:    pageSize,
		Total:       total,
		HasNext:     offset+len(items) < total,
		HasPrevious: page > 1,
	}, nil
}

func (s *Store) UpdateAgent(ctx context.Context, userID string, agentID string, displayName string, purpose string) (auth.AgentUser, error) {
	displayName = strings.TrimSpace(displayName)
	purpose = strings.TrimSpace(purpose)
	var id string
	err := s.db.QueryRow(ctx, `
		UPDATE agents
		SET name = $3, purpose = NULLIF($4, ''), updated_at = now()
		WHERE owner_user_id = $1 AND id::text = $2
		RETURNING id::text
	`, userID, agentID, displayName, purpose).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.AgentUser{}, auth.ErrAgentNotFound
	}
	if constraintViolation(err, "agents_owner_active_name_idx") {
		return auth.AgentUser{}, auth.ErrAgentNameTaken
	}
	if err != nil {
		return auth.AgentUser{}, err
	}
	return s.agents.GetAgent(ctx, userID, id)
}

func (s *Store) RotateCredential(ctx context.Context, userID string, agentID string, idempotencyKey string, tokenHash string, tokenPrefix string) (auth.AgentCredential, bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return auth.AgentCredential{}, false, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", userID+":"+idempotencyKey); err != nil {
		return auth.AgentCredential{}, false, err
	}
	var credential auth.AgentCredential
	var recordedAgentID string
	err = tx.QueryRow(ctx, `
		SELECT credential.id::text, COALESCE(credential.token_prefix, ''), credential.last_used_at,
			credential.revoked_at, credential.created_at, credential.updated_at, rotation.agent_id::text
		FROM agent_credential_rotations rotation
		JOIN agent_credentials credential ON credential.id = rotation.credential_id
		WHERE rotation.owner_user_id = $1 AND rotation.idempotency_key = $2
	`, userID, idempotencyKey).Scan(
		&credential.ID, &credential.TokenPrefix, &credential.LastUsedAt,
		&credential.RevokedAt, &credential.CreatedAt, &credential.UpdatedAt, &recordedAgentID,
	)
	if err == nil {
		if recordedAgentID != agentID {
			return auth.AgentCredential{}, false, ErrIdempotencyConflict
		}
		if err := tx.Commit(ctx); err != nil {
			return auth.AgentCredential{}, false, err
		}
		return credential, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return auth.AgentCredential{}, false, err
	}

	var ownedID string
	err = tx.QueryRow(ctx, `
		SELECT id::text
		FROM agents
		WHERE owner_user_id = $1 AND id::text = $2 AND archived_at IS NULL
		FOR UPDATE
	`, userID, agentID).Scan(&ownedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.AgentCredential{}, false, auth.ErrAgentNotFound
	}
	if err != nil {
		return auth.AgentCredential{}, false, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE agent_credentials
		SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
		WHERE agent_id = $1 AND revoked_at IS NULL
	`, ownedID); err != nil {
		return auth.AgentCredential{}, false, err
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO agent_credentials (agent_id, token_hash, token_prefix)
		VALUES ($1, $2, $3)
		RETURNING id::text, COALESCE(token_prefix, ''), last_used_at, revoked_at, created_at, updated_at
	`, ownedID, tokenHash, tokenPrefix).Scan(
		&credential.ID, &credential.TokenPrefix, &credential.LastUsedAt,
		&credential.RevokedAt, &credential.CreatedAt, &credential.UpdatedAt,
	)
	if err != nil {
		return auth.AgentCredential{}, false, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO agent_credential_rotations (owner_user_id, idempotency_key, agent_id, credential_id)
		VALUES ($1, $2, $3, $4)
	`, userID, idempotencyKey, ownedID, credential.ID); err != nil {
		return auth.AgentCredential{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.AgentCredential{}, false, err
	}
	return credential, true, nil
}

func (s *Store) RevokeCredential(ctx context.Context, userID string, agentID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var ownedID string
	err = tx.QueryRow(ctx, `
		SELECT id::text FROM agents
		WHERE owner_user_id = $1 AND id::text = $2 AND archived_at IS NULL
		FOR UPDATE
	`, userID, agentID).Scan(&ownedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.ErrAgentNotFound
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE agent_credentials
		SET revoked_at = now(), updated_at = now()
		WHERE agent_id = $1 AND revoked_at IS NULL
	`, ownedID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ArchiveAgent(ctx context.Context, userID string, agentID string, unassignOpen bool) (ArchiveConflict, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return ArchiveConflict{}, err
	}
	defer tx.Rollback(ctx)

	var archived bool
	err = tx.QueryRow(ctx, `
		SELECT archived_at IS NOT NULL
		FROM agents
		WHERE owner_user_id = $1 AND id::text = $2
		FOR UPDATE
	`, userID, agentID).Scan(&archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return ArchiveConflict{}, auth.ErrAgentNotFound
	}
	if err != nil {
		return ArchiveConflict{}, err
	}
	if archived {
		if err := tx.Commit(ctx); err != nil {
			return ArchiveConflict{}, err
		}
		return ArchiveConflict{}, nil
	}

	var conflict ArchiveConflict
	rows, err := tx.Query(ctx, `
		SELECT t.status
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		WHERE b.user_id = $1
			AND t.assignee_agent_id = $2
			AND t.status IN ('new', 'queued', 'working')
		FOR UPDATE OF t
	`, userID, agentID)
	if err != nil {
		return ArchiveConflict{}, err
	}
	for rows.Next() {
		var status string
		if err := rows.Scan(&status); err != nil {
			rows.Close()
			return ArchiveConflict{}, err
		}
		switch status {
		case "new":
			conflict.New++
		case "working":
			conflict.Working++
		default:
			conflict.Ready++
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return ArchiveConflict{}, err
	}
	rows.Close()
	if (conflict.New > 0 || conflict.Ready > 0 || conflict.Working > 0) && !unassignOpen {
		return conflict, &ArchiveConflictError{Counts: conflict}
	}
	if unassignOpen {
		if _, err := tx.Exec(ctx, `
			UPDATE tasks t
			SET assignee_agent_id = NULL,
				status = CASE WHEN t.status = 'working' THEN 'queued' ELSE t.status END,
				updated_at = now()
			FROM boards b
			WHERE b.id = t.board_id
				AND b.user_id = $1
				AND t.assignee_agent_id = $2
				AND t.status IN ('new', 'queued', 'working')
		`, userID, agentID); err != nil {
			return ArchiveConflict{}, err
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE agent_credentials
		SET revoked_at = now(), updated_at = now()
		WHERE agent_id = $1 AND revoked_at IS NULL
	`, agentID); err != nil {
		return ArchiveConflict{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE agents
		SET archived_at = now(), updated_at = now()
		WHERE owner_user_id = $1 AND id::text = $2
	`, userID, agentID); err != nil {
		return ArchiveConflict{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ArchiveConflict{}, err
	}
	return conflict, nil
}

func (s *Store) RestoreAgent(ctx context.Context, userID string, agentID string) (auth.AgentUser, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return auth.AgentUser{}, err
	}
	defer tx.Rollback(ctx)

	var activeUserID, role, plan, source string
	err = tx.QueryRow(ctx, `
		SELECT u.id::text, u.role, COALESCE(e.plan, ''), COALESCE(e.source, '')
		FROM users u
		LEFT JOIN entitlements e ON e.user_id = u.id
		WHERE u.id = $1 AND u.disabled_at IS NULL
		FOR UPDATE OF u
	`, userID).Scan(&activeUserID, &role, &plan, &source)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.AgentUser{}, auth.ErrUnauthorized
	}
	if err != nil {
		return auth.AgentUser{}, err
	}
	limits := entitlements.Resolve(role, plan, source).Limits
	var archived bool
	err = tx.QueryRow(ctx, `
		SELECT archived_at IS NOT NULL
		FROM agents
		WHERE owner_user_id = $1 AND id::text = $2
		FOR UPDATE
	`, activeUserID, agentID).Scan(&archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.AgentUser{}, auth.ErrAgentNotFound
	}
	if err != nil {
		return auth.AgentUser{}, err
	}
	if archived {
		var activeAgents int
		if err := tx.QueryRow(ctx, `
			SELECT count(*) FROM agents
			WHERE owner_user_id = $1 AND archived_at IS NULL
		`, activeUserID).Scan(&activeAgents); err != nil {
			return auth.AgentUser{}, err
		}
		if activeAgents >= limits.Agents {
			return auth.AgentUser{}, ErrRestoreLimit
		}
		if _, err := tx.Exec(ctx, `
			UPDATE agent_credentials
			SET revoked_at = COALESCE(revoked_at, now()), updated_at =
				CASE WHEN revoked_at IS NULL THEN now() ELSE updated_at END
			WHERE agent_id = $1
		`, agentID); err != nil {
			return auth.AgentUser{}, err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE agents SET archived_at = NULL, updated_at = now()
			WHERE owner_user_id = $1 AND id::text = $2
		`, activeUserID, agentID); constraintViolation(err, "agents_owner_active_name_idx") {
			return auth.AgentUser{}, ErrRestoreNameTaken
		} else if err != nil {
			return auth.AgentUser{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return auth.AgentUser{}, err
	}
	return s.agents.GetAgent(ctx, activeUserID, agentID)
}

func (s *Store) DeleteAgent(ctx context.Context, userID string, agentID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var archived bool
	err = tx.QueryRow(ctx, `
		SELECT archived_at IS NOT NULL
		FROM agents
		WHERE owner_user_id = $1 AND id::text = $2
		FOR UPDATE
	`, userID, agentID).Scan(&archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.ErrAgentNotFound
	}
	if err != nil {
		return err
	}
	if !archived {
		return ErrDeleteRequiresArchive
	}
	result, err := tx.Exec(ctx, `
		DELETE FROM agents
		WHERE owner_user_id = $1 AND id::text = $2 AND archived_at IS NOT NULL
	`, userID, agentID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return auth.ErrAgentNotFound
	}
	return tx.Commit(ctx)
}

func constraintViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.ConstraintName == constraint
}

func (s *Store) workTotals(ctx context.Context, userID string, agentID string) (WorkTotals, error) {
	var totals WorkTotals
	err := s.db.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE t.status = 'queued'),
			count(*) FILTER (WHERE t.status = 'working'),
			count(*) FILTER (WHERE t.status = 'needs_review'),
			count(*) FILTER (WHERE t.status = 'done')
		FROM tasks t
		JOIN boards b ON b.id = t.board_id
		WHERE b.user_id = $1 AND t.assignee_agent_id = $2 AND t.kind = 'action'
	`, userID, agentID).Scan(&totals.Ready, &totals.Working, &totals.Review, &totals.Completed)
	return totals, err
}

func (s *Store) listInitialOpen(ctx context.Context, userID string, agentID string) ([]WorkItem, error) {
	rows, err := s.db.Query(ctx, workSelect+`
		WHERE b.user_id = $1
			AND t.assignee_agent_id = $2
			AND t.kind = 'action'
			AND t.status IN ('queued', 'working', 'needs_review')
		ORDER BY CASE t.status
			WHEN 'working' THEN 0
			WHEN 'needs_review' THEN 1
			ELSE 2
		END, t.updated_at DESC, t.id
		LIMIT $3
	`, userID, agentID, InitialOpenLimit)
	if err != nil {
		return nil, err
	}
	return scanWorkItems(rows)
}

func (s *Store) listRecentlyCompleted(ctx context.Context, userID string, agentID string) ([]WorkItem, error) {
	rows, err := s.db.Query(ctx, workSelect+`
		WHERE b.user_id = $1
			AND t.assignee_agent_id = $2
			AND t.kind = 'action'
			AND t.status = 'done'
		ORDER BY t.updated_at DESC, t.id
		LIMIT $3
	`, userID, agentID, InitialCompletedLimit)
	if err != nil {
		return nil, err
	}
	return scanWorkItems(rows)
}

const workSelect = `
	SELECT t.id::text, COALESCE(t.parent_task_id::text, ''), t.board_id::text, b.name, t.bucket_id::text, bucket.name,
		t.title, '', COALESCE(t.scheduled_date::text, ''), t.kind,
		t.status, COALESCE(t.assignee_agent_id::text, ''), t.created_at, t.updated_at
	FROM tasks t
	JOIN boards b ON b.id = t.board_id
	JOIN buckets bucket ON bucket.id = t.bucket_id
`

func scanWorkItems(rows pgx.Rows) ([]WorkItem, error) {
	defer rows.Close()
	items := []WorkItem{}
	for rows.Next() {
		var item WorkItem
		if err := rows.Scan(
			&item.ID, &item.ParentTaskID, &item.BoardID, &item.BoardName, &item.BucketID, &item.BucketName,
			&item.Title, &item.Description, &item.ScheduledDate, &item.Kind,
			&item.Status, &item.AssigneeAgentID, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func IsNotFound(err error) bool {
	return errors.Is(err, auth.ErrAgentNotFound)
}
