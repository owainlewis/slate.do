package agents

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/owainlewis/slate.do/server/internal/auth"
)

type fakeStore struct {
	detail        Detail
	detailErr     error
	work          WorkPage
	workErr       error
	detailUserID  string
	detailAgentID string
	workPage      int
	workPageSize  int
}

func (s *fakeStore) GetDetail(_ context.Context, userID string, agentID string) (Detail, error) {
	s.detailUserID = userID
	s.detailAgentID = agentID
	return s.detail, s.detailErr
}

func (s *fakeStore) ListWork(_ context.Context, _ string, _ string, page int, pageSize int) (WorkPage, error) {
	s.workPage = page
	s.workPageSize = pageSize
	return s.work, s.workErr
}

func TestGetDetailMapsOwnedAgentResponses(t *testing.T) {
	store := &fakeStore{detail: Detail{Agent: auth.AgentUser{ID: "agent-1", DisplayName: "Builder"}}}
	handler := NewHandler(store)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/agents/agent-1", nil)
	request.SetPathValue("id", "agent-1")
	response := httptest.NewRecorder()

	handler.GetDetail(response, request, auth.User{ID: "owner-1"})

	if response.Code != http.StatusOK || store.detailUserID != "owner-1" || store.detailAgentID != "agent-1" {
		t.Fatalf("response = %d %q, lookup = %q/%q", response.Code, response.Body.String(), store.detailUserID, store.detailAgentID)
	}

	store.detailErr = auth.ErrAgentNotFound
	response = httptest.NewRecorder()
	handler.GetDetail(response, request, auth.User{ID: "owner-1"})
	if response.Code != http.StatusNotFound {
		t.Fatalf("not found status = %d, want 404", response.Code)
	}

	store.detailErr = errors.New("database unavailable")
	response = httptest.NewRecorder()
	handler.GetDetail(response, request, auth.User{ID: "owner-1"})
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("failed load status = %d, want 500", response.Code)
	}
}

func TestListWorkValidatesAndBoundsPagination(t *testing.T) {
	store := &fakeStore{work: WorkPage{Page: 2, PageSize: 25}}
	handler := NewHandler(store)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/agents/agent-1/work?page=2&pageSize=25", nil)
	request.SetPathValue("id", "agent-1")
	response := httptest.NewRecorder()

	handler.ListWork(response, request, auth.User{ID: "owner-1"})

	if response.Code != http.StatusOK || store.workPage != 2 || store.workPageSize != 25 {
		t.Fatalf("response = %d %q, page = %d/%d", response.Code, response.Body.String(), store.workPage, store.workPageSize)
	}

	for _, target := range []string{
		"/api/v1/agents/agent-1/work?page=0",
		"/api/v1/agents/agent-1/work?page=word",
		"/api/v1/agents/agent-1/work?pageSize=51",
	} {
		request = httptest.NewRequest(http.MethodGet, target, nil)
		request.SetPathValue("id", "agent-1")
		response = httptest.NewRecorder()
		handler.ListWork(response, request, auth.User{ID: "owner-1"})
		if response.Code != http.StatusBadRequest {
			t.Errorf("%s status = %d, want 400", target, response.Code)
		}
	}
}
