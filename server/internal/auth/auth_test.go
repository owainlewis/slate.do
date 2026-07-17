package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHashTokenIsStableAndDoesNotExposeToken(t *testing.T) {
	first := hashToken("slate_secret")
	second := hashToken("slate_secret")
	if first != second {
		t.Fatal("hashToken should be stable")
	}
	if first == "slate_secret" {
		t.Fatal("hashToken should not return the input")
	}
}

func TestReadBearerToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer slate_abc")

	token, ok := readBearerToken(req)
	if !ok || token != "slate_abc" {
		t.Fatalf("token = %q, %v", token, ok)
	}
}

func TestSameOriginRejectsDifferentHost(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "https://slate.test/api", nil)
	req.Host = "slate.test"
	req.Header.Set("Origin", "https://evil.test")
	rec := httptest.NewRecorder()

	if validateSameOrigin(rec, req) {
		t.Fatal("expected different origin to be blocked")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestRequireSessionUserRejectsBearerOnlyAuthentication(t *testing.T) {
	service := NewService(requestAuthStore{}, false)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/tasks/task/status", nil)
	req.Header.Set("Authorization", "Bearer slate_ok")
	rec := httptest.NewRecorder()
	called := false

	service.RequireSessionUser(func(http.ResponseWriter, *http.Request, User) {
		called = true
	})(rec, req)

	if called {
		t.Fatal("bearer token reached a session-only handler")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}

	generalReq := httptest.NewRequest(http.MethodPatch, "/api/v1/tasks/task", nil)
	generalReq.Header.Set("Authorization", "Bearer slate_ok")
	generalRec := httptest.NewRecorder()
	var generalUser User
	service.RequireUser(func(_ http.ResponseWriter, _ *http.Request, user User) {
		generalUser = user
	})(generalRec, generalReq)
	if generalUser.ID != "api-user" {
		t.Fatalf("bearer token should remain valid for general handlers, user = %#v", generalUser)
	}
}

func TestRequireSessionUserAcceptsSessionCookie(t *testing.T) {
	service := NewService(requestAuthStore{}, false)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/tasks/task/status", nil)
	req.AddCookie(&http.Cookie{Name: CookieName, Value: "sess_ok"})
	rec := httptest.NewRecorder()
	var got User

	service.RequireSessionUser(func(_ http.ResponseWriter, _ *http.Request, user User) {
		got = user
	})(rec, req)

	if got.ID != "session-user" {
		t.Fatalf("user = %#v", got)
	}
}

type requestAuthStore struct{}

func (requestAuthStore) CreateOwner(context.Context, string, string) (User, error) {
	return User{}, errors.New("unused")
}
func (requestAuthStore) OwnerCount(context.Context) (int, error) { return 0, errors.New("unused") }
func (requestAuthStore) FindUserByEmail(context.Context, string) (UserWithPassword, error) {
	return UserWithPassword{}, errors.New("unused")
}
func (requestAuthStore) FindUserBySessionHash(_ context.Context, tokenHash string, _ time.Time) (User, error) {
	if tokenHash == hashToken("sess_ok") {
		return User{ID: "session-user"}, nil
	}
	return User{}, ErrUnauthorized
}
func (requestAuthStore) CreateSession(context.Context, string, string, time.Time) error {
	return errors.New("unused")
}
func (requestAuthStore) DeleteSession(context.Context, string) error { return errors.New("unused") }
func (requestAuthStore) ListAPITokens(context.Context, string) ([]APIToken, error) {
	return nil, errors.New("unused")
}
func (requestAuthStore) CreateAPIToken(context.Context, string, string, string) (APIToken, error) {
	return APIToken{}, errors.New("unused")
}
func (requestAuthStore) RevokeAPIToken(context.Context, string, string) error {
	return errors.New("unused")
}
func (requestAuthStore) FindUserByAPITokenHash(_ context.Context, tokenHash string, _ time.Time) (User, error) {
	if tokenHash == hashToken("slate_ok") {
		return User{ID: "api-user"}, nil
	}
	return User{}, ErrUnauthorized
}
