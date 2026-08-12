package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/mail"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/owainlewis/slate.do/server/internal/entitlements"
	"github.com/owainlewis/slate.do/server/internal/httpapi"
	"golang.org/x/crypto/bcrypt"
)

const (
	CookieName            = "slate_session"
	sessionDuration       = 30 * 24 * time.Hour
	signupWindow          = 15 * time.Minute
	signupLimit           = 5
	passwordResetDuration = time.Hour
	passwordResetWindow   = 15 * time.Minute
	passwordResetLimit    = 5
	passwordConfirmWindow = 15 * time.Minute
	passwordConfirmLimit  = 10
	minPasswordLen        = 8
	maxPasswordBytes      = 72
)

var (
	ErrEmailTaken         = errors.New("email already exists")
	ErrInvalidAuth        = errors.New("invalid email or password")
	ErrUnauthorized       = errors.New("unauthorized")
	ErrAdminExists        = errors.New("admin already exists")
	ErrRateLimited        = errors.New("registration rate limit reached")
	ErrMemberNotFound     = errors.New("member account not found")
	ErrInvalidResetToken  = errors.New("invalid or expired password reset token")
	ErrNoPendingReset     = errors.New("no pending password reset request")
	ErrAPITokenLimit      = errors.New("API token limit reached")
	ErrCredentialRejected = errors.New("credential rejected before authentication")
	ErrAgentLimit         = errors.New("active agent limit reached")
	ErrAgentNameTaken     = errors.New("active agent name already exists")
	ErrAgentNotFound      = errors.New("agent not found")
)

type User struct {
	ID           string                   `json:"id"`
	Email        string                   `json:"email"`
	Role         string                   `json:"role"`
	Theme        string                   `json:"theme"`
	DisplayName  string                   `json:"displayName"`
	AgentID      string                   `json:"agentId,omitempty"`
	AgentPurpose string                   `json:"agentPurpose,omitempty"`
	Entitlement  entitlements.Entitlement `json:"entitlement"`
	Usage        entitlements.Usage       `json:"usage"`
}

type UserWithPassword struct {
	User
	PasswordHash string
}

type APIToken struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type AgentCredential struct {
	ID          string     `json:"id"`
	TokenPrefix string     `json:"tokenPrefix,omitempty"`
	LastUsedAt  *time.Time `json:"lastUsedAt,omitempty"`
	RevokedAt   *time.Time `json:"revokedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type AgentWorkCounts struct {
	Ready   int `json:"ready"`
	Working int `json:"working"`
	Review  int `json:"review"`
}

type AgentUser struct {
	ID          string           `json:"id"`
	DisplayName string           `json:"displayName"`
	Purpose     string           `json:"purpose,omitempty"`
	CreatedAt   time.Time        `json:"createdAt"`
	UpdatedAt   time.Time        `json:"updatedAt"`
	Credential  *AgentCredential `json:"credential,omitempty"`
	LastUsedAt  *time.Time       `json:"lastUsedAt,omitempty"`
	RevokedAt   *time.Time       `json:"revokedAt,omitempty"`
	WorkCounts  AgentWorkCounts  `json:"workCounts"`
}

type MemberAccount struct {
	Email      string     `json:"email"`
	DisabledAt *time.Time `json:"disabledAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type PasswordResetRequest struct {
	ID       string
	Email    string
	Attempts int
}

type Store interface {
	CreateAdmin(ctx context.Context, email string, passwordHash string) (User, error)
	CreateInvitedMember(ctx context.Context, email string, passwordHash string, sessionHash string, expiresAt time.Time) (User, error)
	ConsumeSignupAttempt(ctx context.Context, ipHash string, emailHash string, now time.Time, window time.Duration, limit int) (time.Duration, error)
	FindUserByEmail(ctx context.Context, email string) (UserWithPassword, error)
	FindUserBySessionHash(ctx context.Context, tokenHash string, now time.Time) (User, error)
	CreateSession(ctx context.Context, userID string, expectedPasswordHash string, tokenHash string, expiresAt time.Time) error
	DeleteSession(ctx context.Context, tokenHash string) error
	ListAPITokens(ctx context.Context, userID string) ([]APIToken, error)
	CreateAPIToken(ctx context.Context, userID string, name string, tokenHash string) (APIToken, error)
	RevokeAPIToken(ctx context.Context, userID string, id string) error
	FindUserByAPITokenHash(ctx context.Context, tokenHash string, now time.Time) (User, error)
	UpdateTheme(ctx context.Context, userID string, theme string) (User, error)
	ConsumePasswordResetAttempt(ctx context.Context, ipHash string, emailHash string, now time.Time, window time.Duration, limit int) (time.Duration, error)
	ConsumePasswordResetConfirmationAttempt(ctx context.Context, ipHash string, tokenHash string, now time.Time, window time.Duration, limit int) (time.Duration, error)
	QueuePasswordResetRequest(ctx context.Context, email string, now time.Time) error
	ClaimPasswordResetRequest(ctx context.Context, now time.Time) (PasswordResetRequest, error)
	CompletePasswordResetRequest(ctx context.Context, id string, now time.Time) error
	RetryPasswordResetRequest(ctx context.Context, id string, availableAt time.Time) error
	CreatePasswordResetToken(ctx context.Context, email string, tokenHash string, expiresAt time.Time) error
	PasswordResetTokenValid(ctx context.Context, tokenHash string, now time.Time) (bool, error)
	ResetPassword(ctx context.Context, tokenHash string, passwordHash string, now time.Time) error
}

type profileStore interface {
	UpdateProfile(ctx context.Context, userID string, theme *string, displayName *string) (User, error)
}

type usageStore interface {
	AccountUsage(ctx context.Context, userID string) (entitlements.Usage, error)
}

type agentStore interface {
	ListAgents(ctx context.Context, userID string) ([]AgentUser, error)
	CreateAgent(ctx context.Context, userID string, displayName string, purpose string, tokenHash string, tokenPrefix string) (AgentUser, error)
	RevokeAgentToken(ctx context.Context, userID string, agentID string) error
	DeleteAgent(ctx context.Context, userID string, agentID string) error
}

type Options struct {
	InviteCode          string
	AppBaseURL          string
	PasswordResetSender PasswordResetSender
}

type Service struct {
	store               Store
	cookieSecure        bool
	inviteCode          string
	appBaseURL          string
	passwordResetSender PasswordResetSender
	now                 func() time.Time
}

func NewService(store Store, cookieSecure bool, inviteCode ...string) *Service {
	configuredCode := ""
	if len(inviteCode) > 0 {
		configuredCode = inviteCode[0]
	}
	return NewServiceWithOptions(store, cookieSecure, Options{InviteCode: configuredCode})
}

func NewServiceWithOptions(store Store, cookieSecure bool, options Options) *Service {
	return &Service{
		store:               store,
		cookieSecure:        cookieSecure,
		inviteCode:          options.InviteCode,
		appBaseURL:          strings.TrimRight(strings.TrimSpace(options.AppBaseURL), "/"),
		passwordResetSender: options.PasswordResetSender,
		now:                 time.Now,
	}
}

func (s *Service) SignupEnabled() bool {
	return s != nil && s.inviteCode != ""
}

func (s *Service) Register(w http.ResponseWriter, r *http.Request) {
	if !s.SignupEnabled() {
		http.NotFound(w, r)
		return
	}
	if !validateAuthPost(w, r) {
		return
	}
	var input signupInput
	if !decodeJSON(w, r, &input) {
		return
	}

	email := normalizeEmail(input.Email)
	if !httpapi.ByteLimit(w, "email", email, httpapi.EmailBytes) {
		return
	}
	ipHash := hashToken(clientIP(r))
	emailHash := hashToken(email)
	if retryAfter, err := s.store.ConsumeSignupAttempt(r.Context(), ipHash, emailHash, s.now(), signupWindow, signupLimit); errors.Is(err, ErrRateLimited) {
		retrySeconds := (retryAfter + time.Second - 1) / time.Second
		if retrySeconds < 1 {
			retrySeconds = 1
		}
		w.Header().Set("Retry-After", strconv.FormatInt(int64(retrySeconds), 10))
		writeError(w, http.StatusTooManyRequests, "too many registration attempts; try again later")
		return
	} else if err != nil {
		writeInternalError(w, err, "registration is temporarily unavailable")
		return
	}

	if email == "" || input.Password == "" || input.InviteCode == "" {
		writeError(w, http.StatusBadRequest, "email, password, and invite code are required")
		return
	}
	if !validEmail(email) {
		writeError(w, http.StatusBadRequest, "enter a valid email address")
		return
	}
	if len([]rune(input.Password)) < minPasswordLen || len([]byte(input.Password)) > maxPasswordBytes {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters and no more than 72 bytes")
		return
	}
	if !constantTimeEqual(input.InviteCode, s.inviteCode) {
		writeError(w, http.StatusUnauthorized, "invalid invite code")
		return
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		writeInternalError(w, err, "account could not be created")
		return
	}
	sessionToken, err := randomToken("sess")
	if err != nil {
		writeInternalError(w, err, "account could not be created")
		return
	}
	expiresAt := s.now().Add(sessionDuration)
	user, err := s.store.CreateInvitedMember(r.Context(), email, string(passwordHash), hashToken(sessionToken), expiresAt)
	if errors.Is(err, ErrEmailTaken) {
		writeError(w, http.StatusConflict, "an account with that email already exists")
		return
	}
	if err != nil {
		writeInternalError(w, err, "account could not be created")
		return
	}
	setSessionCookie(w, s.cookieSecure, sessionToken, expiresAt)
	writeJSON(w, http.StatusCreated, meResponse{Authenticated: true, User: &user})
}

func SeedAdmin(ctx context.Context, store Store, email string, password string) (User, error) {
	email = normalizeEmail(email)
	if email == "" {
		return User{}, errors.New("admin email is required")
	}
	if len(password) < 12 {
		return User{}, errors.New("admin password must be at least 12 characters")
	}
	existing, err := store.FindUserByEmail(ctx, email)
	if err == nil {
		if existing.Role == "admin" {
			return User{}, ErrAdminExists
		}
		return User{}, ErrEmailTaken
	}
	if !errors.Is(err, ErrInvalidAuth) {
		return User{}, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	return store.CreateAdmin(ctx, email, string(hash))
}

func (s *Service) Login(w http.ResponseWriter, r *http.Request) {
	if !validateAuthPost(w, r) {
		return
	}
	var input credentials
	if !decodeJSON(w, r, &input) {
		return
	}
	email := normalizeEmail(input.Email)
	if email == "" || input.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password are required")
		return
	}

	account, err := s.store.FindUserByEmail(r.Context(), email)
	if errors.Is(err, ErrInvalidAuth) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if err != nil {
		writeInternalError(w, err, "login failed")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(input.Password)) != nil {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if err := s.populateUsage(r.Context(), &account.User); err != nil {
		writeInternalError(w, err, "account usage could not be loaded")
		return
	}
	if !s.createSession(w, r, account.User, account.PasswordHash) {
		return
	}
	writeJSON(w, http.StatusOK, meResponse{Authenticated: true, User: &account.User})
}

func (s *Service) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	if !validateAuthPost(w, r) {
		return
	}
	var input struct {
		Email string `json:"email"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	email := normalizeEmail(input.Email)
	if !httpapi.ByteLimit(w, "email", email, httpapi.EmailBytes) {
		return
	}
	if email == "" || !validEmail(email) {
		writeError(w, http.StatusBadRequest, "enter a valid email address")
		return
	}
	if s.passwordResetSender == nil || s.appBaseURL == "" {
		writeError(w, http.StatusServiceUnavailable, "password reset is temporarily unavailable")
		return
	}
	if _, err := s.store.ConsumePasswordResetAttempt(r.Context(), hashToken(clientIP(r)), hashToken(email), s.now(), passwordResetWindow, passwordResetLimit); err != nil {
		if !errors.Is(err, ErrRateLimited) {
			slog.Error("password reset rate limit failed", "error", err)
		}
		writePasswordResetAccepted(w)
		return
	}
	if err := s.store.QueuePasswordResetRequest(r.Context(), email, s.now()); err != nil {
		slog.Error("password reset request queue failed", "error", err)
	}
	writePasswordResetAccepted(w)
}

func (s *Service) RunPasswordResetWorker(ctx context.Context) {
	if s == nil || s.passwordResetSender == nil || s.appBaseURL == "" {
		return
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		processed, err := s.processPasswordResetRequest(ctx)
		if err != nil {
			slog.Error("password reset worker failed", "error", err)
		}
		if processed && err == nil {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) processPasswordResetRequest(ctx context.Context) (bool, error) {
	now := s.now()
	request, err := s.store.ClaimPasswordResetRequest(ctx, now)
	if errors.Is(err, ErrNoPendingReset) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	retry := func(processErr error) (bool, error) {
		delay := time.Duration(request.Attempts) * time.Minute
		if delay > time.Hour {
			delay = time.Hour
		}
		if err := s.store.RetryPasswordResetRequest(ctx, request.ID, now.Add(delay)); err != nil {
			return true, err
		}
		slog.Error("password reset delivery failed", "error", processErr, "attempt", request.Attempts)
		return true, nil
	}
	token, err := randomToken("reset")
	if err != nil {
		return retry(err)
	}
	if err := s.store.CreatePasswordResetToken(ctx, request.Email, hashToken(token), now.Add(passwordResetDuration)); errors.Is(err, ErrInvalidAuth) {
		return true, s.store.CompletePasswordResetRequest(ctx, request.ID, now)
	} else if err != nil {
		return retry(err)
	}
	resetURL := s.appBaseURL + "/reset-password#token=" + url.QueryEscape(token)
	idempotencyKey := "password-reset-" + request.ID + "-" + strconv.Itoa(request.Attempts)
	if err := s.passwordResetSender.SendPasswordReset(ctx, request.Email, resetURL, idempotencyKey); err != nil {
		return retry(err)
	}
	return true, s.store.CompletePasswordResetRequest(ctx, request.ID, now)
}

func writePasswordResetAccepted(w http.ResponseWriter) {
	writeJSON(w, http.StatusAccepted, map[string]string{"message": "If an account exists for that email, a password reset link is on its way."})
}

func (s *Service) ResetPassword(w http.ResponseWriter, r *http.Request) {
	if !validateAuthPost(w, r) {
		return
	}
	var input struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Token) == "" {
		writeError(w, http.StatusBadRequest, "reset link is invalid or has expired")
		return
	}
	if len([]rune(input.Password)) < minPasswordLen || len([]byte(input.Password)) > maxPasswordBytes {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters and no more than 72 bytes")
		return
	}
	if retryAfter, err := s.store.ConsumePasswordResetConfirmationAttempt(r.Context(), hashToken(clientIP(r)), hashToken(input.Token), s.now(), passwordConfirmWindow, passwordConfirmLimit); errors.Is(err, ErrRateLimited) {
		retrySeconds := (retryAfter + time.Second - 1) / time.Second
		if retrySeconds < 1 {
			retrySeconds = 1
		}
		w.Header().Set("Retry-After", strconv.FormatInt(int64(retrySeconds), 10))
		writeError(w, http.StatusTooManyRequests, "too many reset attempts; try again later")
		return
	} else if err != nil {
		writeError(w, http.StatusServiceUnavailable, "password reset is temporarily unavailable")
		return
	}
	valid, err := s.store.PasswordResetTokenValid(r.Context(), hashToken(input.Token), s.now())
	if err != nil {
		writeInternalError(w, err, "password could not be reset")
		return
	}
	if !valid {
		writeError(w, http.StatusBadRequest, "reset link is invalid or has expired")
		return
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "password could not be reset")
		return
	}
	if err := s.store.ResetPassword(r.Context(), hashToken(input.Token), string(passwordHash), s.now()); errors.Is(err, ErrInvalidResetToken) {
		writeError(w, http.StatusBadRequest, "reset link is invalid or has expired")
		return
	} else if err != nil {
		writeInternalError(w, err, "password could not be reset")
		return
	}
	clearSessionCookie(w, s.cookieSecure)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	if !validateSameOrigin(w, r) {
		return
	}
	if token, ok := s.readSessionToken(r); ok {
		if err := s.store.DeleteSession(r.Context(), hashToken(token)); err != nil {
			clearSessionCookie(w, s.cookieSecure)
			writeInternalError(w, err, "logout failed")
			return
		}
	}
	clearSessionCookie(w, s.cookieSecure)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) Me(w http.ResponseWriter, r *http.Request) {
	user, _, err := s.ResolveUserFromRequest(r)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusOK, meResponse{Authenticated: false})
			return
		}
		writeInternalError(w, err, "authentication failed")
		return
	}
	s.MeForUser(w, r, user)
}

func (s *Service) MeForUser(w http.ResponseWriter, r *http.Request, user User) {
	if user.AgentID == "" {
		if err := s.populateUsage(r.Context(), &user); err != nil {
			writeInternalError(w, err, "account usage could not be loaded")
			return
		}
	}
	capabilities := ServerCapabilities()
	writeJSON(w, http.StatusOK, meResponse{Authenticated: true, User: &user, Capabilities: &capabilities})
}

func (s *Service) populateUsage(ctx context.Context, user *User) error {
	store, ok := s.store.(usageStore)
	if !ok {
		return nil
	}
	usage, err := store.AccountUsage(ctx, user.ID)
	if err != nil {
		return err
	}
	user.Usage = usage
	return nil
}

func (s *Service) UpdateTheme(w http.ResponseWriter, r *http.Request, user User) {
	if !validateSameOrigin(w, r) {
		return
	}
	var input struct {
		Theme       *string `json:"theme"`
		DisplayName *string `json:"displayName"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Theme == nil && input.DisplayName == nil {
		writeError(w, http.StatusBadRequest, "theme or display name is required")
		return
	}
	if input.Theme != nil {
		if *input.Theme != "light" && *input.Theme != "dark" {
			writeError(w, http.StatusBadRequest, "theme must be light or dark")
			return
		}
	}
	if input.DisplayName != nil {
		displayName := strings.TrimSpace(*input.DisplayName)
		if displayName == "" {
			writeError(w, http.StatusBadRequest, "display name is required")
			return
		}
		if !httpapi.RuneLimit(w, "displayName", displayName, httpapi.DisplayNameRunes) {
			return
		}
		input.DisplayName = &displayName
	}
	store, ok := s.store.(profileStore)
	if !ok {
		writeError(w, http.StatusInternalServerError, "profile could not be updated")
		return
	}
	updated, err := store.UpdateProfile(r.Context(), user.ID, input.Theme, input.DisplayName)
	if errors.Is(err, ErrUnauthorized) {
		clearSessionCookie(w, s.cookieSecure)
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if err != nil {
		writeInternalError(w, err, "profile could not be updated")
		return
	}
	if err := s.populateUsage(r.Context(), &updated); err != nil {
		writeInternalError(w, err, "account usage could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Service) UserFromRequest(r *http.Request) (User, bool) {
	user, _, err := s.ResolveUserFromRequest(r)
	return user, err == nil
}

func (s *Service) UserFromRequestWithCredential(r *http.Request) (User, string, bool) {
	user, credential, err := s.ResolveUserFromRequest(r)
	return user, credential, err == nil
}

func (s *Service) ResolveUserFromRequest(r *http.Request) (User, string, error) {
	return s.ResolveUserFromRequestWithGate(r, nil)
}

func (s *Service) ResolveUserFromRequestWithGate(r *http.Request, gate func(string) bool) (User, string, error) {
	sessionRejected := false
	if _, ok := s.readSessionToken(r); ok {
		user, credential, err := s.ResolveSessionUserFromRequestWithGate(r, gate)
		if err == nil {
			return user, credential, nil
		}
		if errors.Is(err, ErrCredentialRejected) {
			sessionRejected = true
		} else if !errors.Is(err, ErrUnauthorized) {
			return User{}, "", err
		}
	}
	token, ok := readBearerToken(r)
	if !ok {
		if sessionRejected {
			return User{}, "", ErrCredentialRejected
		}
		return User{}, "", ErrUnauthorized
	}
	tokenHash := hashToken(token)
	credential := "bearer:" + tokenHash
	if gate != nil && !gate(credential) {
		return User{}, "", ErrCredentialRejected
	}
	user, err := s.store.FindUserByAPITokenHash(r.Context(), tokenHash, s.now())
	if err != nil {
		return User{}, "", err
	}
	return user, credential, nil
}

func (s *Service) UserFromSessionRequest(r *http.Request) (User, bool) {
	user, _, err := s.ResolveSessionUserFromRequest(r)
	return user, err == nil
}

func (s *Service) UserFromSessionRequestWithCredential(r *http.Request) (User, string, bool) {
	user, credential, err := s.ResolveSessionUserFromRequest(r)
	return user, credential, err == nil
}

func (s *Service) ResolveSessionUserFromRequest(r *http.Request) (User, string, error) {
	return s.ResolveSessionUserFromRequestWithGate(r, nil)
}

func (s *Service) ResolveSessionUserFromRequestWithGate(r *http.Request, gate func(string) bool) (User, string, error) {
	token, ok := s.readSessionToken(r)
	if !ok {
		return User{}, "", ErrUnauthorized
	}
	tokenHash := hashToken(token)
	credential := "session:" + tokenHash
	if gate != nil && !gate(credential) {
		return User{}, "", ErrCredentialRejected
	}
	user, err := s.store.FindUserBySessionHash(r.Context(), tokenHash, s.now())
	if err != nil {
		return User{}, "", err
	}
	return user, credential, nil
}

func (s *Service) RequireUser(next func(http.ResponseWriter, *http.Request, User)) http.HandlerFunc {
	return s.RequireUserWithCredential(func(w http.ResponseWriter, r *http.Request, user User, _ string) {
		next(w, r, user)
	})
}

func (s *Service) RequireUserWithCredential(next func(http.ResponseWriter, *http.Request, User, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, credential, err := s.ResolveUserFromRequest(r)
		if err != nil {
			if !errors.Is(err, ErrUnauthorized) {
				writeInternalError(w, err, "authentication failed")
				return
			}
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		next(w, r, user, credential)
	}
}

func (s *Service) RequireSessionUser(next func(http.ResponseWriter, *http.Request, User)) http.HandlerFunc {
	return s.RequireSessionUserWithCredential(func(w http.ResponseWriter, r *http.Request, user User, _ string) {
		next(w, r, user)
	})
}

func (s *Service) RequireSessionUserWithCredential(next func(http.ResponseWriter, *http.Request, User, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, credential, err := s.ResolveSessionUserFromRequest(r)
		if err != nil {
			if !errors.Is(err, ErrUnauthorized) {
				writeInternalError(w, err, "authentication failed")
				return
			}
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		next(w, r, user, credential)
	}
}

func (s *Service) ListAPITokens(w http.ResponseWriter, r *http.Request, user User) {
	tokens, err := s.store.ListAPITokens(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, err, "API tokens could not be loaded")
		return
	}
	if tokens == nil {
		tokens = []APIToken{}
	}
	writeJSON(w, http.StatusOK, map[string][]APIToken{"tokens": tokens})
}

func (s *Service) CreateAPIToken(w http.ResponseWriter, r *http.Request, user User) {
	if !validateAuthPost(w, r) {
		return
	}
	var input apiTokenInput
	if !decodeJSON(w, r, &input) {
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "token name is required")
		return
	}
	if !httpapi.RuneLimit(w, "name", name, httpapi.APITokenNameRunes) {
		return
	}

	plain, err := randomToken("slate")
	if err != nil {
		writeInternalError(w, err, "API token could not be created")
		return
	}
	token, err := s.store.CreateAPIToken(r.Context(), user.ID, name, hashToken(plain))
	if errors.Is(err, ErrAPITokenLimit) {
		writeCodedError(w, http.StatusConflict, "api_token_limit_reached", fmt.Sprintf("%s allows up to %d API tokens.", planName(user.Entitlement.Plan), user.Entitlement.Limits.APITokens))
		return
	}
	if errors.Is(err, ErrUnauthorized) {
		clearSessionCookie(w, s.cookieSecure)
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if err != nil {
		writeInternalError(w, err, "API token could not be created")
		return
	}
	writeJSON(w, http.StatusCreated, createAPITokenResponse{Token: plain, APIToken: token})
}

func planName(plan string) string {
	if plan == entitlements.PlanPro {
		return "Pro"
	}
	return "Free"
}

func (s *Service) RevokeAPIToken(w http.ResponseWriter, r *http.Request, user User) {
	if !validateSameOrigin(w, r) {
		return
	}
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusNotFound, "API token not found")
		return
	}
	err := s.store.RevokeAPIToken(r.Context(), user.ID, id)
	if err != nil {
		writeInternalError(w, err, "API token could not be revoked")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) ListAgents(w http.ResponseWriter, r *http.Request, user User) {
	store, ok := s.store.(agentStore)
	if !ok {
		writeError(w, http.StatusInternalServerError, "agents could not be loaded")
		return
	}
	agents, err := store.ListAgents(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, err, "agents could not be loaded")
		return
	}
	if agents == nil {
		agents = []AgentUser{}
	}
	activeAgents := len(agents)
	writeJSON(w, http.StatusOK, struct {
		Agents       []AgentUser `json:"agents"`
		ActiveAgents int         `json:"activeAgents"`
		MaxAgents    int         `json:"maxAgents"`
	}{
		Agents:       agents,
		ActiveAgents: activeAgents,
		MaxAgents:    user.Entitlement.Limits.Agents,
	})
}

func (s *Service) CreateAgent(w http.ResponseWriter, r *http.Request, user User) {
	if !validateAuthPost(w, r) {
		return
	}
	var input struct {
		DisplayName string `json:"displayName"`
		Purpose     string `json:"purpose"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		writeError(w, http.StatusBadRequest, "agent name is required")
		return
	}
	if !httpapi.RuneLimit(w, "displayName", displayName, httpapi.AgentNameRunes) {
		return
	}
	purpose := strings.TrimSpace(input.Purpose)
	if !httpapi.ByteLimit(w, "purpose", purpose, httpapi.AgentInstructionsBytes) {
		return
	}
	plain, err := randomToken("slate_agent")
	if err != nil {
		writeInternalError(w, err, "agent could not be created")
		return
	}
	store, ok := s.store.(agentStore)
	if !ok {
		writeError(w, http.StatusInternalServerError, "agent could not be created")
		return
	}
	agent, err := store.CreateAgent(r.Context(), user.ID, displayName, purpose, hashToken(plain), tokenDisplayPrefix(plain))
	if errors.Is(err, ErrAgentLimit) {
		writeCodedError(w, http.StatusConflict, "agent_limit_reached", fmt.Sprintf("%s allows up to %d agents. Delete an agent before creating another.", planName(user.Entitlement.Plan), user.Entitlement.Limits.Agents))
		return
	}
	if errors.Is(err, ErrAgentNameTaken) {
		writeCodedError(w, http.StatusConflict, "agent_name_taken", "An active agent with that name already exists.")
		return
	}
	if errors.Is(err, ErrUnauthorized) {
		clearSessionCookie(w, s.cookieSecure)
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if err != nil {
		writeInternalError(w, err, "agent could not be created")
		return
	}
	writeJSON(w, http.StatusCreated, createAgentResponse{Token: plain, AgentUser: agent})
}

func (s *Service) RevokeAgentToken(w http.ResponseWriter, r *http.Request, user User) {
	if !validateSameOrigin(w, r) {
		return
	}
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}
	store, ok := s.store.(agentStore)
	if !ok {
		writeError(w, http.StatusInternalServerError, "agent token could not be revoked")
		return
	}
	err := store.RevokeAgentToken(r.Context(), user.ID, id)
	if errors.Is(err, ErrAgentNotFound) {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}
	if err != nil {
		writeInternalError(w, err, "agent token could not be revoked")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) DeleteAgent(w http.ResponseWriter, r *http.Request, user User) {
	if !validateSameOrigin(w, r) {
		return
	}
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}
	store, ok := s.store.(agentStore)
	if !ok {
		writeError(w, http.StatusInternalServerError, "agent could not be deleted")
		return
	}
	err := store.DeleteAgent(r.Context(), user.ID, id)
	if errors.Is(err, ErrAgentNotFound) {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}
	if err != nil {
		writeInternalError(w, err, "agent could not be deleted")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) createSession(w http.ResponseWriter, r *http.Request, user User, expectedPasswordHash string) bool {
	token, err := randomToken("sess")
	if err != nil {
		writeInternalError(w, err, "session could not be created")
		return false
	}
	expiresAt := s.now().Add(sessionDuration)
	if err := s.store.CreateSession(r.Context(), user.ID, expectedPasswordHash, hashToken(token), expiresAt); err != nil {
		if errors.Is(err, ErrUnauthorized) {
			clearSessionCookie(w, s.cookieSecure)
			writeError(w, http.StatusUnauthorized, "invalid email or password")
			return false
		}
		writeInternalError(w, err, "session could not be created")
		return false
	}
	setSessionCookie(w, s.cookieSecure, token, expiresAt)
	return true
}

func setSessionCookie(w http.ResponseWriter, secure bool, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Service) readSessionToken(r *http.Request) (string, bool) {
	cookie, err := r.Cookie(CookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return "", false
	}
	return cookie.Value, true
}

func readBearerToken(r *http.Request) (string, bool) {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if header == "" {
		return "", false
	}
	kind, token, ok := strings.Cut(header, " ")
	if !ok || !strings.EqualFold(kind, "Bearer") || strings.TrimSpace(token) == "" {
		return "", false
	}
	return strings.TrimSpace(token), true
}

func randomToken(prefix string) (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(bytes), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func RateLimitIPKey(r *http.Request) string {
	return hashToken(clientIP(r))
}

func tokenDisplayPrefix(token string) string {
	const displayLength = 20
	if len(token) <= displayLength {
		return token
	}
	return token[:displayLength]
}

func constantTimeEqual(left string, right string) bool {
	leftHash := sha256.Sum256([]byte(left))
	rightHash := sha256.Sum256([]byte(right))
	return subtle.ConstantTimeCompare(leftHash[:], rightHash[:]) == 1
}

func clientIP(r *http.Request) string {
	var forwarded []netip.Addr
	for part := range strings.SplitSeq(r.Header.Get("X-Forwarded-For"), ",") {
		if addr, err := netip.ParseAddr(strings.TrimSpace(part)); err == nil {
			forwarded = append(forwarded, addr.Unmap())
		}
	}
	if len(forwarded) >= 2 {
		return forwarded[len(forwarded)-2].String()
	}
	if len(forwarded) == 1 {
		return forwarded[0].String()
	}
	host := strings.TrimSpace(r.RemoteAddr)
	if addrPort, err := netip.ParseAddrPort(host); err == nil {
		return addrPort.Addr().Unmap().String()
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr.Unmap().String()
	}
	return "unknown"
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func validEmail(email string) bool {
	if len(email) > httpapi.EmailBytes {
		return false
	}
	address, err := mail.ParseAddress(email)
	return err == nil && address.Address == email
}

func validateAuthPost(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return false
	}
	if !validateSameOrigin(w, r) {
		return false
	}
	return true
}

func validateSameOrigin(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	host := r.Host
	if host == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && strings.EqualFold(parsed.Host, host) && parsed.User == nil {
		return true
	}
	writeError(w, http.StatusForbidden, "cross-origin request blocked")
	return false
}

func clearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	return httpapi.DecodeJSON(w, r, target)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeInternalError(w http.ResponseWriter, err error, message string) {
	if httpapi.WriteServiceUnavailable(w, err) {
		return
	}
	writeError(w, http.StatusInternalServerError, message)
}

func writeCodedError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, map[string]string{"code": code, "error": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func validID(id string) bool {
	if len(id) != 36 {
		return false
	}
	for i, r := range id {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
				return false
			}
		}
	}
	return true
}

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type signupInput struct {
	Email      string `json:"email"`
	Password   string `json:"password"`
	InviteCode string `json:"inviteCode"`
}

type meResponse struct {
	Authenticated bool          `json:"authenticated"`
	User          *User         `json:"user,omitempty"`
	Capabilities  *Capabilities `json:"capabilities,omitempty"`
}

// Capabilities lets a client refuse to start against a server that has not been
// deployed with the workflow it needs. The watcher requires managed runs.
type Capabilities struct {
	ManagedRuns bool `json:"managedRuns"`
}

// ServerCapabilities reports what this build supports.
func ServerCapabilities() Capabilities {
	return Capabilities{ManagedRuns: true}
}

type apiTokenInput struct {
	Name string `json:"name"`
}

type createAPITokenResponse struct {
	Token string `json:"token"`
	APIToken
}

type createAgentResponse struct {
	Token string `json:"token"`
	AgentUser
}
