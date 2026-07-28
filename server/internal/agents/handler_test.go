package agents

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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
	updateAgent   auth.AgentUser
	updateErr     error
	rotate        auth.AgentCredential
	rotateApplied bool
	rotateErr     error
	revokeErr     error
	archiveCounts ArchiveConflict
	archiveErr    error
	restoreAgent  auth.AgentUser
	restoreErr    error
	lastUserID    string
	lastAgentID   string
	lastName      string
	lastPurpose   string
	lastKey       string
	lastTokenHash string
	lastPrefix    string
	unassignOpen  bool
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

func (s *fakeStore) UpdateAgent(_ context.Context, userID, agentID, name, purpose string) (auth.AgentUser, error) {
	s.lastUserID, s.lastAgentID, s.lastName, s.lastPurpose = userID, agentID, name, purpose
	return s.updateAgent, s.updateErr
}

func (s *fakeStore) RotateCredential(_ context.Context, userID, agentID, key, tokenHash, prefix string) (auth.AgentCredential, bool, error) {
	s.lastUserID, s.lastAgentID, s.lastKey, s.lastTokenHash, s.lastPrefix = userID, agentID, key, tokenHash, prefix
	return s.rotate, s.rotateApplied, s.rotateErr
}

func (s *fakeStore) RevokeCredential(_ context.Context, userID, agentID string) error {
	s.lastUserID, s.lastAgentID = userID, agentID
	return s.revokeErr
}

func (s *fakeStore) ArchiveAgent(_ context.Context, userID, agentID string, unassignOpen bool) (ArchiveConflict, error) {
	s.lastUserID, s.lastAgentID, s.unassignOpen = userID, agentID, unassignOpen
	return s.archiveCounts, s.archiveErr
}

func (s *fakeStore) RestoreAgent(_ context.Context, userID, agentID string) (auth.AgentUser, error) {
	s.lastUserID, s.lastAgentID = userID, agentID
	return s.restoreAgent, s.restoreErr
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

func TestAgentLifecycleHandlersValidateAndMapStableResponses(t *testing.T) {
	store := &fakeStore{
		updateAgent:   auth.AgentUser{ID: "agent-1", DisplayName: "Builder"},
		rotate:        auth.AgentCredential{ID: "credential-1", TokenPrefix: "slate_agent_example"},
		rotateApplied: true,
		restoreAgent:  auth.AgentUser{ID: "agent-1", DisplayName: "Builder"},
	}
	handler := NewHandler(store)
	user := auth.User{ID: "owner-1"}

	response := lifecycleRequest(t, handler.Update, user, http.MethodPatch, `{"displayName":"  Builder  ","purpose":"  Ships work  "}`)
	if response.Code != http.StatusOK || store.lastName != "Builder" || store.lastPurpose != "Ships work" {
		t.Fatalf("update = %d %q, input = %q/%q", response.Code, response.Body.String(), store.lastName, store.lastPurpose)
	}
	store.updateErr = auth.ErrAgentNameTaken
	response = lifecycleRequest(t, handler.Update, user, http.MethodPatch, `{"displayName":"builder","purpose":""}`)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "agent_name_taken") {
		t.Fatalf("duplicate update = %d %q", response.Code, response.Body.String())
	}
	store.updateErr = nil

	response = lifecycleRequest(t, handler.RotateCredential, user, http.MethodPost, `{"idempotencyKey":"rotation-key-0000000000000001"}`)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" || store.lastKey != "rotation-key-0000000000000001" || store.lastTokenHash == "" || !strings.Contains(response.Body.String(), "slate_agent_") {
		t.Fatalf("rotation = %d %q, key/hash = %q/%q", response.Code, response.Body.String(), store.lastKey, store.lastTokenHash)
	}
	store.rotateApplied = false
	response = lifecycleRequest(t, handler.RotateCredential, user, http.MethodPost, `{"idempotencyKey":"rotation-key-0000000000000001"}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"alreadyApplied":true`) || strings.Contains(response.Body.String(), `"token"`) {
		t.Fatalf("rotation replay = %d %q", response.Code, response.Body.String())
	}
	response = lifecycleRequest(t, handler.RotateCredential, user, http.MethodPost, `{"idempotencyKey":"short"}`)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid rotation = %d %q", response.Code, response.Body.String())
	}

	response = lifecycleRequest(t, handler.RevokeCredential, user, http.MethodDelete, "")
	if response.Code != http.StatusOK || store.lastUserID != user.ID || store.lastAgentID != "agent-1" {
		t.Fatalf("revoke = %d %q, owner = %q/%q", response.Code, response.Body.String(), store.lastUserID, store.lastAgentID)
	}

	store.archiveErr = &ArchiveConflictError{Counts: ArchiveConflict{Ready: 2, Working: 1}}
	response = lifecycleRequest(t, handler.Archive, user, http.MethodPost, `{"unassignOpenWork":false}`)
	var conflict struct {
		Code     string `json:"code"`
		Conflict struct {
			Ready   int `json:"ready"`
			Working int `json:"working"`
		} `json:"conflict"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &conflict); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusConflict || conflict.Code != "agent_open_work" || conflict.Conflict.Ready != 2 || conflict.Conflict.Working != 1 {
		t.Fatalf("archive conflict = %d %#v", response.Code, conflict)
	}
	store.archiveErr = nil
	response = lifecycleRequest(t, handler.Archive, user, http.MethodPost, `{"unassignOpenWork":true}`)
	if response.Code != http.StatusOK || !store.unassignOpen {
		t.Fatalf("forced archive = %d %q", response.Code, response.Body.String())
	}

	store.restoreErr = ErrRestoreLimit
	response = lifecycleRequest(t, handler.Restore, user, http.MethodPost, `{}`)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "agent_limit_reached") {
		t.Fatalf("restore limit = %d %q", response.Code, response.Body.String())
	}

	request := httptest.NewRequest(http.MethodPatch, "/api/v1/agents/agent-1", strings.NewReader(`{"displayName":"Builder","purpose":""}`))
	request.Host = "slate.test"
	request.Header.Set("Origin", "https://evil.test")
	request.SetPathValue("id", "agent-1")
	response = httptest.NewRecorder()
	handler.Update(response, request, user)
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-origin update = %d %q", response.Code, response.Body.String())
	}
}

func lifecycleRequest(t *testing.T, method func(http.ResponseWriter, *http.Request, auth.User), user auth.User, httpMethod string, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(httpMethod, "/api/v1/agents/agent-1", strings.NewReader(body))
	request.SetPathValue("id", "agent-1")
	response := httptest.NewRecorder()
	method(response, request, user)
	return response
}
