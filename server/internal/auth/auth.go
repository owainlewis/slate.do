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
	"net/http"
	"net/mail"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/owainlewis/slate.do/server/internal/entitlements"
	"golang.org/x/crypto/bcrypt"
)

const (
	CookieName       = "slate_session"
	sessionDuration  = 30 * 24 * time.Hour
	signupWindow     = 15 * time.Minute
	signupLimit      = 5
	minPasswordLen   = 8
	maxPasswordBytes = 72
)

var (
	ErrEmailTaken     = errors.New("email already exists")
	ErrInvalidAuth    = errors.New("invalid email or password")
	ErrUnauthorized   = errors.New("unauthorized")
	ErrAdminExists    = errors.New("admin already exists")
	ErrRateLimited    = errors.New("registration rate limit reached")
	ErrMemberNotFound = errors.New("member account not found")
)

type User struct {
	ID          string                   `json:"id"`
	Email       string                   `json:"email"`
	Role        string                   `json:"role"`
	Theme       string                   `json:"theme"`
	Entitlement entitlements.Entitlement `json:"entitlement"`
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

type MemberAccount struct {
	Email      string     `json:"email"`
	DisabledAt *time.Time `json:"disabledAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type Store interface {
	CreateAdmin(ctx context.Context, email string, passwordHash string) (User, error)
	CreateInvitedMember(ctx context.Context, email string, passwordHash string, sessionHash string, expiresAt time.Time) (User, error)
	ConsumeSignupAttempt(ctx context.Context, ipHash string, emailHash string, now time.Time, window time.Duration, limit int) (time.Duration, error)
	FindUserByEmail(ctx context.Context, email string) (UserWithPassword, error)
	FindUserBySessionHash(ctx context.Context, tokenHash string, now time.Time) (User, error)
	CreateSession(ctx context.Context, userID string, tokenHash string, expiresAt time.Time) error
	DeleteSession(ctx context.Context, tokenHash string) error
	ListAPITokens(ctx context.Context, userID string) ([]APIToken, error)
	CreateAPIToken(ctx context.Context, userID string, name string, tokenHash string) (APIToken, error)
	RevokeAPIToken(ctx context.Context, userID string, id string) error
	FindUserByAPITokenHash(ctx context.Context, tokenHash string, now time.Time) (User, error)
	UpdateTheme(ctx context.Context, userID string, theme string) (User, error)
}

type Service struct {
	store        Store
	cookieSecure bool
	inviteCode   string
	now          func() time.Time
}

func NewService(store Store, cookieSecure bool, inviteCode ...string) *Service {
	configuredCode := ""
	if len(inviteCode) > 0 {
		configuredCode = inviteCode[0]
	}
	return &Service{
		store:        store,
		cookieSecure: cookieSecure,
		inviteCode:   configuredCode,
		now:          time.Now,
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
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	var input signupInput
	if !decodeJSON(w, r, &input) {
		return
	}

	email := normalizeEmail(input.Email)
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
		writeError(w, http.StatusInternalServerError, "registration is temporarily unavailable")
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
		writeError(w, http.StatusInternalServerError, "account could not be created")
		return
	}
	sessionToken, err := randomToken("sess")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "account could not be created")
		return
	}
	expiresAt := s.now().Add(sessionDuration)
	user, err := s.store.CreateInvitedMember(r.Context(), email, string(passwordHash), hashToken(sessionToken), expiresAt)
	if errors.Is(err, ErrEmailTaken) {
		writeError(w, http.StatusConflict, "an account with that email already exists")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "account could not be created")
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
		writeError(w, http.StatusInternalServerError, "login failed")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte(input.Password)) != nil {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if account.Entitlement.Plan != entitlements.PlanPro {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if !s.createSession(w, r, account.User) {
		return
	}
	writeJSON(w, http.StatusOK, meResponse{Authenticated: true, User: &account.User})
}

func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	if !validateSameOrigin(w, r) {
		return
	}
	if token, ok := s.readSessionToken(r); ok {
		if err := s.store.DeleteSession(r.Context(), hashToken(token)); err != nil {
			clearSessionCookie(w, s.cookieSecure)
			writeError(w, http.StatusInternalServerError, "logout failed")
			return
		}
	}
	clearSessionCookie(w, s.cookieSecure)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) Me(w http.ResponseWriter, r *http.Request) {
	user, ok := s.UserFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusOK, meResponse{Authenticated: false})
		return
	}
	writeJSON(w, http.StatusOK, meResponse{Authenticated: true, User: &user})
}

func (s *Service) UpdateTheme(w http.ResponseWriter, r *http.Request, user User) {
	if !validateSameOrigin(w, r) {
		return
	}
	var input struct {
		Theme string `json:"theme"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Theme != "light" && input.Theme != "dark" {
		writeError(w, http.StatusBadRequest, "theme must be light or dark")
		return
	}
	updated, err := s.store.UpdateTheme(r.Context(), user.ID, input.Theme)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "theme could not be updated")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Service) UserFromRequest(r *http.Request) (User, bool) {
	if user, ok := s.UserFromSessionRequest(r); ok {
		return user, true
	}
	token, ok := readBearerToken(r)
	if !ok {
		return User{}, false
	}
	user, err := s.store.FindUserByAPITokenHash(r.Context(), hashToken(token), s.now())
	return user, err == nil
}

func (s *Service) UserFromSessionRequest(r *http.Request) (User, bool) {
	token, ok := s.readSessionToken(r)
	if !ok {
		return User{}, false
	}
	user, err := s.store.FindUserBySessionHash(r.Context(), hashToken(token), s.now())
	return user, err == nil
}

func (s *Service) RequireUser(next func(http.ResponseWriter, *http.Request, User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.UserFromRequest(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		next(w, r, user)
	}
}

func (s *Service) RequireSessionUser(next func(http.ResponseWriter, *http.Request, User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.UserFromSessionRequest(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		next(w, r, user)
	}
}

func (s *Service) ListAPITokens(w http.ResponseWriter, r *http.Request, user User) {
	tokens, err := s.store.ListAPITokens(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "API tokens could not be loaded")
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
	if len([]rune(name)) > 80 {
		writeError(w, http.StatusBadRequest, "token name must be 80 characters or fewer")
		return
	}

	plain, err := randomToken("slate")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "API token could not be created")
		return
	}
	token, err := s.store.CreateAPIToken(r.Context(), user.ID, name, hashToken(plain))
	if errors.Is(err, ErrUnauthorized) {
		clearSessionCookie(w, s.cookieSecure)
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "API token could not be created")
		return
	}
	writeJSON(w, http.StatusCreated, createAPITokenResponse{Token: plain, APIToken: token})
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
		writeError(w, http.StatusInternalServerError, "API token could not be revoked")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Service) createSession(w http.ResponseWriter, r *http.Request, user User) bool {
	token, err := randomToken("sess")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session could not be created")
		return false
	}
	expiresAt := s.now().Add(sessionDuration)
	if err := s.store.CreateSession(r.Context(), user.ID, hashToken(token), expiresAt); err != nil {
		if errors.Is(err, ErrUnauthorized) {
			clearSessionCookie(w, s.cookieSecure)
			writeError(w, http.StatusUnauthorized, "invalid email or password")
			return false
		}
		writeError(w, http.StatusInternalServerError, "session could not be created")
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
	if len(email) > 254 {
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
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
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
	Authenticated bool  `json:"authenticated"`
	User          *User `json:"user,omitempty"`
}

type apiTokenInput struct {
	Name string `json:"name"`
}

type createAPITokenResponse struct {
	Token string `json:"token"`
	APIToken
}
