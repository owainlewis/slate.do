package agents

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/database"
)

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

func (s *Store) workTotals(ctx context.Context, userID string, agentID string) (WorkTotals, error) {
	var totals WorkTotals
	err := s.db.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE t.status = 'queued' AND NOT t.done),
			count(*) FILTER (WHERE t.status = 'working' AND NOT t.done),
			count(*) FILTER (WHERE t.status = 'needs_review' AND NOT t.done),
			count(*) FILTER (WHERE t.done)
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
			AND NOT t.done
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
			AND t.done
		ORDER BY t.updated_at DESC, t.id
		LIMIT $3
	`, userID, agentID, InitialCompletedLimit)
	if err != nil {
		return nil, err
	}
	return scanWorkItems(rows)
}

const workSelect = `
	SELECT t.id::text, t.board_id::text, b.name, t.bucket_id::text, bucket.name,
		t.title, t.description, COALESCE(t.scheduled_date::text, ''), t.kind,
		t.done, t.status, COALESCE(t.assignee_agent_id::text, ''), t.created_at, t.updated_at
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
			&item.ID, &item.BoardID, &item.BoardName, &item.BucketID, &item.BucketName,
			&item.Title, &item.Description, &item.ScheduledDate, &item.Kind,
			&item.Done, &item.Status, &item.AssigneeAgentID, &item.CreatedAt, &item.UpdatedAt,
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
