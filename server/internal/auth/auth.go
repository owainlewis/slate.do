package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	CookieName      = "slate_session"
	sessionDuration = 30 * 24 * time.Hour
)

var (
	ErrEmailTaken   = errors.New("email already exists")
	ErrInvalidAuth  = errors.New("invalid email or password")
	ErrUnauthorized = errors.New("unauthorized")
	ErrOwnerExists  = errors.New("owner already exists")
)

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Role  string `json:"role"`
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

type Store interface {
	CreateOwner(ctx context.Context, email string, passwordHash string) (User, error)
	OwnerCount(ctx context.Context) (int, error)
	FindUserByEmail(ctx context.Context, email string) (UserWithPassword, error)
	FindUserBySessionHash(ctx context.Context, tokenHash string, now time.Time) (User, error)
	CreateSession(ctx context.Context, userID string, tokenHash string, expiresAt time.Time) error
	DeleteSession(ctx context.Context, tokenHash string) error
	ListAPITokens(ctx context.Context, userID string) ([]APIToken, error)
	CreateAPIToken(ctx context.Context, userID string, name string, tokenHash string) (APIToken, error)
	RevokeAPIToken(ctx context.Context, userID string, id string) error
	FindUserByAPITokenHash(ctx context.Context, tokenHash string, now time.Time) (User, error)
}

type Service struct {
	store        Store
	cookieSecure bool
	now          func() time.Time
}

func NewService(store Store, cookieSecure bool) *Service {
	return &Service{
		store:        store,
		cookieSecure: cookieSecure,
		now:          time.Now,
	}
}

func SeedOwner(ctx context.Context, store Store, email string, password string) (User, error) {
	email = normalizeEmail(email)
	if email == "" {
		return User{}, errors.New("owner email is required")
	}
	if len(password) < 12 {
		return User{}, errors.New("owner password must be at least 12 characters")
	}
	count, err := store.OwnerCount(ctx)
	if err != nil {
		return User{}, err
	}
	if count > 0 {
		return User{}, ErrOwnerExists
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	return store.CreateOwner(ctx, email, string(hash))
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
		writeError(w, http.StatusInternalServerError, "session could not be created")
		return false
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   s.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	return true
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

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
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
	if strings.Contains(origin, "://"+host) {
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
