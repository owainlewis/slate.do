package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/entitlements"
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

func TestSameOriginRejectsHostPrefixAttack(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "https://slate.test/api", nil)
	req.Host = "slate.test"
	req.Header.Set("Origin", "https://slate.test.evil.example")
	rec := httptest.NewRecorder()

	if validateSameOrigin(rec, req) {
		t.Fatal("expected deceptive origin to be blocked")
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

func TestMeExposesResolvedProPlanAndLimits(t *testing.T) {
	service := NewService(requestAuthStore{}, false)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.AddCookie(&http.Cookie{Name: CookieName, Value: "sess_ok"})
	recorder := httptest.NewRecorder()

	service.Me(recorder, req)

	body := recorder.Body.String()
	if recorder.Code != http.StatusOK || !strings.Contains(body, `"plan":"pro"`) || !strings.Contains(body, `"boards":5`) || !strings.Contains(body, `"listsPerBoard":9`) || !strings.Contains(body, `"activeItemsPerList":20`) {
		t.Fatalf("status = %d, body = %s", recorder.Code, body)
	}
}

func TestUpdateThemePersistsUserPreference(t *testing.T) {
	store := &themeAuthStore{requestAuthStore: requestAuthStore{}}
	service := NewService(store, false)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/me", strings.NewReader(`{"theme":"dark"}`))
	rec := httptest.NewRecorder()

	service.UpdateTheme(rec, req, User{ID: "owner"})

	if rec.Code != http.StatusOK || store.theme != "dark" {
		t.Fatalf("status = %d, theme = %q", rec.Code, store.theme)
	}
}

func TestUpdateThemeRejectsUnknownTheme(t *testing.T) {
	store := &themeAuthStore{requestAuthStore: requestAuthStore{}}
	service := NewService(store, false)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/me", strings.NewReader(`{"theme":"sepia"}`))
	rec := httptest.NewRecorder()

	service.UpdateTheme(rec, req, User{ID: "owner"})

	if rec.Code != http.StatusBadRequest || store.theme != "" {
		t.Fatalf("status = %d, theme = %q", rec.Code, store.theme)
	}
}

func TestRegisterCreatesInvitedProMemberAndSessionCookie(t *testing.T) {
	store := &signupAuthStore{}
	service := NewService(store, false, "correct horse battery staple")
	req := httptest.NewRequest(http.MethodPost, "https://slate.test/api/v1/auth/register", strings.NewReader(`{"email":" NEW@Example.com ","password":"abcd1234","inviteCode":"correct horse battery staple"}`))
	req.Host = "slate.test"
	req.Header.Set("Origin", "https://slate.test")
	req.Header.Set("X-Forwarded-For", "203.0.113.9, 35.191.0.1")
	rec := httptest.NewRecorder()

	service.Register(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if store.email != "new@example.com" || store.passwordHash == "abcd1234" || store.sessionHash == "" {
		t.Fatalf("stored signup = email %q, password %q, session %q", store.email, store.passwordHash, store.sessionHash)
	}
	if store.ipHash != hashToken("203.0.113.9") || store.emailHash != hashToken("new@example.com") {
		t.Fatalf("rate-limit keys = %q, %q", store.ipHash, store.emailHash)
	}
	result := rec.Result()
	cookies := result.Cookies()
	if len(cookies) != 1 || cookies[0].Name != CookieName || !cookies[0].HttpOnly || cookies[0].Value == "" {
		t.Fatalf("cookies = %#v", cookies)
	}
	if strings.Contains(rec.Body.String(), "correct horse battery staple") || strings.Contains(rec.Body.String(), "abcd1234") {
		t.Fatal("response exposed credentials")
	}
}

func TestRegisterFailsSafely(t *testing.T) {
	tests := []struct {
		name       string
		inviteCode string
		body       string
		store      *signupAuthStore
		status     int
	}{
		{"missing configuration", "", `{"email":"new@example.com","password":"a secure password","inviteCode":"secret"}`, &signupAuthStore{}, http.StatusNotFound},
		{"invalid code", "secret", `{"email":"new@example.com","password":"a secure password","inviteCode":"wrong"}`, &signupAuthStore{}, http.StatusUnauthorized},
		{"seven-character password", "secret", `{"email":"new@example.com","password":"abc1234","inviteCode":"secret"}`, &signupAuthStore{}, http.StatusBadRequest},
		{"invalid email", "secret", `{"email":"not-an-email","password":"a secure password","inviteCode":"secret"}`, &signupAuthStore{}, http.StatusBadRequest},
		{"duplicate email", "secret", `{"email":"new@example.com","password":"a secure password","inviteCode":"secret"}`, &signupAuthStore{createErr: ErrEmailTaken}, http.StatusConflict},
		{"rate limited", "secret", `{"email":"new@example.com","password":"a secure password","inviteCode":"secret"}`, &signupAuthStore{rateErr: ErrRateLimited}, http.StatusTooManyRequests},
		{"partial failure", "secret", `{"email":"new@example.com","password":"a secure password","inviteCode":"secret"}`, &signupAuthStore{createErr: errors.New("database failed")}, http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := NewService(tt.store, false, tt.inviteCode)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(tt.body))
			rec := httptest.NewRecorder()
			service.Register(rec, req)
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d; body = %s", rec.Code, tt.status, rec.Body.String())
			}
			if tt.status != http.StatusCreated && len(rec.Result().Cookies()) != 0 {
				t.Fatal("failed signup set a session cookie")
			}
			if strings.Contains(rec.Body.String(), "secret") || strings.Contains(rec.Body.String(), "database failed") {
				t.Fatalf("unsafe error body = %s", rec.Body.String())
			}
		})
	}
}

func TestRegisterRotationRejectsOldCodeAndAcceptsNewCode(t *testing.T) {
	store := &signupAuthStore{}
	service := NewService(store, false, "new-code")

	oldRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"old@example.com","password":"a secure password","inviteCode":"old-code"}`))
	oldRecorder := httptest.NewRecorder()
	service.Register(oldRecorder, oldRequest)
	if oldRecorder.Code != http.StatusUnauthorized || store.email != "" {
		t.Fatalf("old code response = %d, created email = %q", oldRecorder.Code, store.email)
	}

	newRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"email":"new@example.com","password":"a secure password","inviteCode":"new-code"}`))
	newRecorder := httptest.NewRecorder()
	service.Register(newRecorder, newRequest)
	if newRecorder.Code != http.StatusCreated || store.email != "new@example.com" {
		t.Fatalf("new code response = %d, created email = %q", newRecorder.Code, store.email)
	}
}

func TestClientIPUsesCloudRunAppendedAddresses(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("X-Forwarded-For", "198.51.100.88, 203.0.113.9, 35.191.0.1")
	if got := clientIP(req); got != "203.0.113.9" {
		t.Fatalf("clientIP = %q, want Cloud Run client address", got)
	}
}

func TestSeedAdminCreatesNamedAdminWhenAnotherAdminExists(t *testing.T) {
	store := &seedAdminStore{
		users: map[string]UserWithPassword{
			"first@example.com": {User: User{Email: "first@example.com", Role: "admin"}},
		},
	}

	user, err := SeedAdmin(context.Background(), store, " NEW@Example.com ", "a-secure-password")
	if err != nil {
		t.Fatal(err)
	}
	if user.Email != "new@example.com" || user.Role != "admin" {
		t.Fatalf("user = %#v", user)
	}
}

func TestSeedAdminIsIdempotentForSameEmail(t *testing.T) {
	store := &seedAdminStore{
		users: map[string]UserWithPassword{
			"admin@example.com": {User: User{Email: "admin@example.com", Role: "admin"}},
		},
	}

	_, err := SeedAdmin(context.Background(), store, "admin@example.com", "a-secure-password")
	if !errors.Is(err, ErrAdminExists) {
		t.Fatalf("error = %v, want ErrAdminExists", err)
	}
}

func TestSeedAdminDoesNotPromoteExistingMember(t *testing.T) {
	store := &seedAdminStore{
		users: map[string]UserWithPassword{
			"member@example.com": {User: User{Email: "member@example.com", Role: "member"}},
		},
	}

	_, err := SeedAdmin(context.Background(), store, "member@example.com", "a-secure-password")
	if !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("error = %v, want ErrEmailTaken", err)
	}
}

type requestAuthStore struct{}

type signupAuthStore struct {
	requestAuthStore
	email        string
	passwordHash string
	sessionHash  string
	ipHash       string
	emailHash    string
	createErr    error
	rateErr      error
}

func (s *signupAuthStore) ConsumeSignupAttempt(_ context.Context, ipHash string, emailHash string, _ time.Time, _ time.Duration, _ int) (time.Duration, error) {
	s.ipHash = ipHash
	s.emailHash = emailHash
	return 0, s.rateErr
}

func (s *signupAuthStore) CreateInvitedMember(_ context.Context, email string, passwordHash string, sessionHash string, _ time.Time) (User, error) {
	s.email = email
	s.passwordHash = passwordHash
	s.sessionHash = sessionHash
	if s.createErr != nil {
		return User{}, s.createErr
	}
	return User{ID: "member", Email: email, Role: "member", Entitlement: entitlements.Pro(entitlements.SourceInviteCode)}, nil
}

func (requestAuthStore) CreateAdmin(context.Context, string, string) (User, error) {
	return User{}, errors.New("unused")
}
func (requestAuthStore) CreateInvitedMember(context.Context, string, string, string, time.Time) (User, error) {
	return User{}, errors.New("unused")
}
func (requestAuthStore) ConsumeSignupAttempt(context.Context, string, string, time.Time, time.Duration, int) (time.Duration, error) {
	return 0, errors.New("unused")
}
func (requestAuthStore) FindUserByEmail(context.Context, string) (UserWithPassword, error) {
	return UserWithPassword{}, errors.New("unused")
}

type seedAdminStore struct {
	requestAuthStore
	users map[string]UserWithPassword
}

func (s *seedAdminStore) FindUserByEmail(_ context.Context, email string) (UserWithPassword, error) {
	user, ok := s.users[email]
	if !ok {
		return UserWithPassword{}, ErrInvalidAuth
	}
	return user, nil
}

func (s *seedAdminStore) CreateAdmin(_ context.Context, email string, passwordHash string) (User, error) {
	user := User{ID: "new-admin", Email: email, Role: "admin", Theme: "light"}
	s.users[email] = UserWithPassword{User: user, PasswordHash: passwordHash}
	return user, nil
}
func (requestAuthStore) FindUserBySessionHash(_ context.Context, tokenHash string, _ time.Time) (User, error) {
	if tokenHash == hashToken("sess_ok") {
		return User{ID: "session-user", Entitlement: entitlements.Pro(entitlements.SourceAdmin)}, nil
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
		return User{ID: "api-user", Entitlement: entitlements.Pro(entitlements.SourceManual)}, nil
	}
	return User{}, ErrUnauthorized
}
func (requestAuthStore) UpdateTheme(context.Context, string, string) (User, error) {
	return User{}, errors.New("unused")
}

type themeAuthStore struct {
	requestAuthStore
	theme string
}

func (s *themeAuthStore) UpdateTheme(_ context.Context, userID string, theme string) (User, error) {
	s.theme = theme
	return User{ID: userID, Theme: theme}, nil
}
