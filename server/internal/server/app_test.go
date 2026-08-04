package server

import (
	"context"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/ratelimit"
)

func TestEarlyAccessPageFollowsInviteConfiguration(t *testing.T) {
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("signup shell")}}

	disabled := (&App{static: static}).Routes()
	for _, target := range []string{"/early-access", "/early-access/"} {
		disabledRecorder := httptest.NewRecorder()
		disabled.ServeHTTP(disabledRecorder, httptest.NewRequest(http.MethodGet, target, nil))
		if disabledRecorder.Code != http.StatusNotFound {
			t.Errorf("disabled GET %s status = %d, want 404", target, disabledRecorder.Code)
		}
	}

	enabled := (&App{static: fs.FS(static), auth: auth.NewService(nil, false, "configured")}).Routes()
	for _, target := range []string{"/early-access", "/early-access/"} {
		enabledRecorder := httptest.NewRecorder()
		enabled.ServeHTTP(enabledRecorder, httptest.NewRequest(http.MethodGet, target, nil))
		if enabledRecorder.Code != http.StatusOK || enabledRecorder.Body.String() != "signup shell" {
			t.Errorf("enabled GET %s response = %d %q", target, enabledRecorder.Code, enabledRecorder.Body.String())
		}
	}
}

func TestEarlyAccessNestedPathIsNotFound(t *testing.T) {
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("signup shell")}}
	handler := (&App{static: fs.FS(static), auth: auth.NewService(nil, false, "configured")}).Routes()
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/early-access/extra", nil))

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
}

func TestResetPasswordPageServesApplicationShell(t *testing.T) {
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("reset shell")}}
	handler := (&App{static: fs.FS(static)}).Routes()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/reset-password", nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != "reset shell" {
		t.Fatalf("response = %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestAuthenticatedRouteClassesSeparateReadsAndWrites(t *testing.T) {
	for _, test := range []struct {
		name       string
		method     string
		routeClass string
	}{
		{name: "browser session read", method: http.MethodGet, routeClass: ratelimit.ClassAuthenticatedRead},
		{name: "API token write", method: http.MethodPatch, routeClass: ratelimit.ClassAuthenticatedWrite},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, "/api/v1/tasks", nil)
			if got := authenticatedRouteClass(request); got != test.routeClass {
				t.Fatalf("class = %q, want %q", got, test.routeClass)
			}
		})
	}
}

func TestPublicAuthLimitsUseHashedIPAndStableRejection(t *testing.T) {
	limiter := &recordingLimiter{decision: ratelimit.Decision{Allowed: false, Limit: 20, Remaining: 0, RetryAfter: 1250 * time.Millisecond}}
	app := &App{limits: limiter}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	request.Header.Set("X-Forwarded-For", "203.0.113.9, 35.191.0.1")
	recorder := httptest.NewRecorder()

	if app.allowPublicAuth(recorder, request) {
		t.Fatal("limited request was allowed")
	}
	if limiter.routeClass != ratelimit.ClassPublicAuth || len(limiter.keys) != 1 || limiter.keys[0].Scope != ratelimit.ScopeIP || strings.Contains(limiter.keys[0].Value, "203.0.113.9") {
		t.Fatalf("class = %q, keys = %#v", limiter.routeClass, limiter.keys)
	}
	if recorder.Code != http.StatusTooManyRequests || recorder.Header().Get("Retry-After") != "2" || recorder.Header().Get("RateLimit-Limit") != "20" || !strings.Contains(recorder.Body.String(), `"code":"rate_limit_exceeded"`) {
		t.Fatalf("status = %d, headers = %#v, body = %s", recorder.Code, recorder.Header(), recorder.Body.String())
	}
}

func TestRateLimitStorageFailureFailsClosed(t *testing.T) {
	app := &App{limits: &recordingLimiter{err: errors.New("database unavailable")}}
	recorder := httptest.NewRecorder()
	if app.allowPublicAuth(recorder, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)) {
		t.Fatal("request was allowed")
	}
	if recorder.Code != http.StatusServiceUnavailable || !strings.Contains(recorder.Body.String(), `"code":"rate_limit_unavailable"`) {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

type recordingLimiter struct {
	keys       []ratelimit.Key
	routeClass string
	decision   ratelimit.Decision
	err        error
}

func (l *recordingLimiter) Allow(_ context.Context, keys []ratelimit.Key, routeClass string) (ratelimit.Decision, error) {
	l.keys = append([]ratelimit.Key(nil), keys...)
	l.routeClass = routeClass
	return l.decision, l.err
}
