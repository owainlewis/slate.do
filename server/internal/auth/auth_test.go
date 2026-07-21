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
	"golang.org/x/crypto/bcrypt"
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

func TestRequestPasswordResetQueuesGenericRequestBeforeDelivery(t *testing.T) {
	store := &passwordResetAuthStore{claim: PasswordResetRequest{ID: "request-id", Email: "person@example.com", Attempts: 1}}
	sender := &recordingPasswordResetSender{}
	service := NewServiceWithOptions(store, false, Options{
		AppBaseURL:          "https://slate.do/",
		PasswordResetSender: sender,
	})
	fixedNow := time.Date(2026, time.July, 21, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return fixedNow }
	req := httptest.NewRequest(http.MethodPost, "https://slate.do/api/v1/auth/password-reset/request", strings.NewReader(`{"email":" Person@Example.com "}`))
	req.Host = "slate.do"
	req.Header.Set("Origin", "https://slate.do")
	req.RemoteAddr = "203.0.113.10:1234"
	rec := httptest.NewRecorder()

	service.RequestPasswordReset(rec, req)

	if rec.Code != http.StatusAccepted || !strings.Contains(rec.Body.String(), "If an account exists") {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if store.queuedEmail != "person@example.com" {
		t.Fatalf("queued email = %q", store.queuedEmail)
	}
	if sender.email != "" {
		t.Fatal("request handler delivered email synchronously")
	}
	processed, err := service.processPasswordResetRequest(context.Background())
	if err != nil || !processed {
		t.Fatalf("worker processed = %v, error = %v", processed, err)
	}
	if store.email != "person@example.com" || store.tokenHash == "" || store.expiresAt != fixedNow.Add(time.Hour) {
		t.Fatalf("stored reset = email %q, hash %q, expiry %s", store.email, store.tokenHash, store.expiresAt)
	}
	if sender.email != "person@example.com" || !strings.HasPrefix(sender.resetURL, "https://slate.do/reset-password#token=reset_") || sender.idempotencyKey != "password-reset-request-id-1" {
		t.Fatalf("sent reset = email %q, url %q", sender.email, sender.resetURL)
	}
	plainToken := strings.TrimPrefix(sender.resetURL, "https://slate.do/reset-password#token=")
	if store.tokenHash != hashToken(plainToken) || strings.Contains(rec.Body.String(), plainToken) {
		t.Fatal("reset token was not stored and returned safely")
	}
}

func TestRequestPasswordResetDoesNotRevealQueueOrRateLimitState(t *testing.T) {
	for _, tt := range []struct {
		name     string
		queueErr error
		rateErr  error
	}{
		{name: "queue failure", queueErr: errors.New("database unavailable")},
		{name: "rate limited", rateErr: ErrRateLimited},
	} {
		t.Run(tt.name, func(t *testing.T) {
			store := &passwordResetAuthStore{queueErr: tt.queueErr, rateErr: tt.rateErr}
			sender := &recordingPasswordResetSender{}
			service := NewServiceWithOptions(store, false, Options{AppBaseURL: "https://slate.do", PasswordResetSender: sender})
			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/request", strings.NewReader(`{"email":"person@example.com"}`))
			rec := httptest.NewRecorder()
			service.RequestPasswordReset(rec, req)
			if rec.Code != http.StatusAccepted || !strings.Contains(rec.Body.String(), "If an account exists") {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestPasswordResetWorkerSkipsUnknownAccountsAndRetriesDeliveryFailures(t *testing.T) {
	unknownStore := &passwordResetAuthStore{
		claim:     PasswordResetRequest{ID: "unknown", Email: "unknown@example.com", Attempts: 1},
		createErr: ErrInvalidAuth,
	}
	unknownSender := &recordingPasswordResetSender{}
	unknownService := NewServiceWithOptions(unknownStore, false, Options{AppBaseURL: "https://slate.do", PasswordResetSender: unknownSender})
	if processed, err := unknownService.processPasswordResetRequest(context.Background()); err != nil || !processed {
		t.Fatalf("unknown processed = %v, error = %v", processed, err)
	}
	if unknownSender.email != "" || unknownStore.completedID != "unknown" {
		t.Fatalf("unknown delivery = %q, completed = %q", unknownSender.email, unknownStore.completedID)
	}

	failureStore := &passwordResetAuthStore{claim: PasswordResetRequest{ID: "retry", Email: "person@example.com", Attempts: 2}}
	failureSender := &recordingPasswordResetSender{err: errors.New("resend unavailable")}
	failureService := NewServiceWithOptions(failureStore, false, Options{AppBaseURL: "https://slate.do", PasswordResetSender: failureSender})
	fixedNow := time.Date(2026, time.July, 21, 12, 0, 0, 0, time.UTC)
	failureService.now = func() time.Time { return fixedNow }
	if processed, err := failureService.processPasswordResetRequest(context.Background()); err != nil || !processed {
		t.Fatalf("failure processed = %v, error = %v", processed, err)
	}
	if failureStore.retriedID != "retry" || failureStore.retryAt != fixedNow.Add(2*time.Minute) {
		t.Fatalf("retry = %q at %s", failureStore.retriedID, failureStore.retryAt)
	}
}

func TestResetPasswordHashesPasswordAndRejectsReusedToken(t *testing.T) {
	store := &passwordResetAuthStore{tokenValid: true}
	service := NewService(store, false)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(`{"token":"reset_secret","password":"a new secure password"}`))
	rec := httptest.NewRecorder()

	service.ResetPassword(rec, req)

	if rec.Code != http.StatusOK || store.resetTokenHash != hashToken("reset_secret") {
		t.Fatalf("status = %d, token hash = %q", rec.Code, store.resetTokenHash)
	}
	if bcrypt.CompareHashAndPassword([]byte(store.passwordHash), []byte("a new secure password")) != nil {
		t.Fatal("new password was not bcrypt hashed")
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != CookieName || cookies[0].MaxAge != -1 {
		t.Fatalf("cookies = %#v", cookies)
	}

	store.resetErr = ErrInvalidResetToken
	store.tokenValid = false
	reused := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(`{"token":"reset_secret","password":"another secure password"}`))
	reusedRecorder := httptest.NewRecorder()
	service.ResetPassword(reusedRecorder, reused)
	if reusedRecorder.Code != http.StatusBadRequest || !strings.Contains(reusedRecorder.Body.String(), "invalid or has expired") {
		t.Fatalf("status = %d, body = %s", reusedRecorder.Code, reusedRecorder.Body.String())
	}
}

func TestResetPasswordRateLimitRunsBeforeBcryptAndMutation(t *testing.T) {
	store := &passwordResetAuthStore{tokenValid: true, rateErr: ErrRateLimited}
	service := NewService(store, false)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(`{"token":"reset_secret","password":"a new secure password"}`))
	rec := httptest.NewRecorder()

	service.ResetPassword(rec, req)

	if rec.Code != http.StatusTooManyRequests || store.resetTokenHash != "" || store.passwordHash != "" {
		t.Fatalf("status = %d, token hash = %q, password hash = %q", rec.Code, store.resetTokenHash, store.passwordHash)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("rate-limited reset did not include Retry-After")
	}
}

func TestResetPasswordRejectsInvalidTokenBeforeBcrypt(t *testing.T) {
	store := &passwordResetAuthStore{tokenValid: false}
	service := NewService(store, false)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(`{"token":"reset_invalid","password":"a new secure password"}`))
	rec := httptest.NewRecorder()

	service.ResetPassword(rec, req)

	if rec.Code != http.StatusBadRequest || store.passwordHash != "" || store.resetTokenHash != "" {
		t.Fatalf("status = %d, password hash = %q, reset hash = %q", rec.Code, store.passwordHash, store.resetTokenHash)
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

type recordingPasswordResetSender struct {
	email          string
	resetURL       string
	idempotencyKey string
	err            error
}

func (s *recordingPasswordResetSender) SendPasswordReset(_ context.Context, email string, resetURL string, idempotencyKey string) error {
	s.email = email
	s.resetURL = resetURL
	s.idempotencyKey = idempotencyKey
	return s.err
}

type passwordResetAuthStore struct {
	requestAuthStore
	queuedEmail    string
	queueErr       error
	claim          PasswordResetRequest
	claimErr       error
	completedID    string
	retriedID      string
	retryAt        time.Time
	email          string
	tokenHash      string
	expiresAt      time.Time
	resetTokenHash string
	passwordHash   string
	createErr      error
	rateErr        error
	resetErr       error
	tokenValid     bool
}

func (s *passwordResetAuthStore) ConsumePasswordResetAttempt(context.Context, string, string, time.Time, time.Duration, int) (time.Duration, error) {
	return 0, s.rateErr
}

func (s *passwordResetAuthStore) ConsumePasswordResetConfirmationAttempt(context.Context, string, string, time.Time, time.Duration, int) (time.Duration, error) {
	return 0, s.rateErr
}

func (s *passwordResetAuthStore) QueuePasswordResetRequest(_ context.Context, email string, _ time.Time) error {
	s.queuedEmail = email
	return s.queueErr
}

func (s *passwordResetAuthStore) ClaimPasswordResetRequest(context.Context, time.Time) (PasswordResetRequest, error) {
	return s.claim, s.claimErr
}

func (s *passwordResetAuthStore) CompletePasswordResetRequest(_ context.Context, id string, _ time.Time) error {
	s.completedID = id
	return nil
}

func (s *passwordResetAuthStore) RetryPasswordResetRequest(_ context.Context, id string, availableAt time.Time) error {
	s.retriedID = id
	s.retryAt = availableAt
	return nil
}

func (s *passwordResetAuthStore) CreatePasswordResetToken(_ context.Context, email string, tokenHash string, expiresAt time.Time) error {
	s.email = email
	s.tokenHash = tokenHash
	s.expiresAt = expiresAt
	return s.createErr
}

func (s *passwordResetAuthStore) PasswordResetTokenValid(context.Context, string, time.Time) (bool, error) {
	return s.tokenValid, nil
}
func (s *passwordResetAuthStore) ResetPassword(_ context.Context, tokenHash string, passwordHash string, _ time.Time) error {
	s.resetTokenHash = tokenHash
	s.passwordHash = passwordHash
	return s.resetErr
}

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
func (requestAuthStore) ConsumePasswordResetAttempt(context.Context, string, string, time.Time, time.Duration, int) (time.Duration, error) {
	return 0, errors.New("unused")
}
func (requestAuthStore) ConsumePasswordResetConfirmationAttempt(context.Context, string, string, time.Time, time.Duration, int) (time.Duration, error) {
	return 0, errors.New("unused")
}
func (requestAuthStore) QueuePasswordResetRequest(context.Context, string, time.Time) error {
	return errors.New("unused")
}
func (requestAuthStore) ClaimPasswordResetRequest(context.Context, time.Time) (PasswordResetRequest, error) {
	return PasswordResetRequest{}, errors.New("unused")
}
func (requestAuthStore) CompletePasswordResetRequest(context.Context, string, time.Time) error {
	return errors.New("unused")
}
func (requestAuthStore) RetryPasswordResetRequest(context.Context, string, time.Time) error {
	return errors.New("unused")
}
func (requestAuthStore) CreatePasswordResetToken(context.Context, string, string, time.Time) error {
	return errors.New("unused")
}
func (requestAuthStore) PasswordResetTokenValid(context.Context, string, time.Time) (bool, error) {
	return false, errors.New("unused")
}
func (requestAuthStore) ResetPassword(context.Context, string, string, time.Time) error {
	return errors.New("unused")
}

type themeAuthStore struct {
	requestAuthStore
	theme string
}

func (s *themeAuthStore) UpdateTheme(_ context.Context, userID string, theme string) (User, error) {
	s.theme = theme
	return User{ID: userID, Theme: theme}, nil
}
