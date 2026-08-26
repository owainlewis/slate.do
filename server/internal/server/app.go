package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"strconv"

	"github.com/owainlewis/slate.do/server/internal/agents"
	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/boards"
	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/httpapi"
	"github.com/owainlewis/slate.do/server/internal/ratelimit"
)

type App struct {
	static fs.FS
	db     *database.Pool
	auth   *auth.Service
	agents *agents.Handler
	boards *boards.Handler
	limits ratelimit.Limiter
}

func (a *App) RunPasswordResetWorker(ctx context.Context) {
	if a.auth != nil {
		a.auth.RunPasswordResetWorker(ctx)
	}
}

func NewApp(static fs.FS, db *database.Pool, cookieSecure bool, options auth.Options) *App {
	app := &App{static: static, db: db}
	if db != nil {
		authStore := auth.NewPGStore(db)
		app.auth = auth.NewServiceWithOptions(authStore, cookieSecure, options)
		app.agents = agents.NewHandler(agents.NewStore(db, authStore))
		app.boards = boards.NewHandler(boards.NewStore(db))
		app.limits = ratelimit.NewPG(db)
	}
	return app
}

func (a *App) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/v1/me", a.me)
	mux.HandleFunc("PATCH /api/v1/me", a.session(a.auth.UpdateTheme))
	mux.HandleFunc("POST /api/v1/auth/login", a.publicAuth(a.login))
	mux.HandleFunc("POST /api/v1/auth/register", a.publicAuth(a.register))
	mux.HandleFunc("POST /api/v1/auth/logout", a.logout)
	mux.HandleFunc("POST /api/v1/auth/password-reset/request", a.publicAuth(a.requestPasswordReset))
	mux.HandleFunc("POST /api/v1/auth/password-reset/confirm", a.publicAuth(a.resetPassword))
	mux.HandleFunc("GET /api/v1/api-tokens", a.session(a.auth.ListAPITokens))
	mux.HandleFunc("POST /api/v1/api-tokens", a.session(a.auth.CreateAPIToken))
	mux.HandleFunc("DELETE /api/v1/api-tokens/{id}", a.session(a.auth.RevokeAPIToken))
	mux.HandleFunc("GET /api/v1/agents", a.session(a.auth.ListAgents))
	mux.HandleFunc("POST /api/v1/agents", a.session(a.auth.CreateAgent))
	mux.HandleFunc("GET /api/v1/agents/{id}", a.session(a.agents.GetDetail))
	mux.HandleFunc("PATCH /api/v1/agents/{id}", a.session(a.agents.Update))
	mux.HandleFunc("GET /api/v1/agents/{id}/work", a.session(a.agents.ListWork))
	mux.HandleFunc("POST /api/v1/agents/{id}/credential/rotate", a.session(a.agents.RotateCredential))
	mux.HandleFunc("DELETE /api/v1/agents/{id}/credential", a.session(a.agents.RevokeCredential))
	// Compatibility for clients released before credentials became their own
	// lifecycle. The token alias remains owner-scoped.
	mux.HandleFunc("DELETE /api/v1/agents/{id}/token", a.session(a.agents.RevokeCredential))
	mux.HandleFunc("DELETE /api/v1/agents/{id}", a.session(a.auth.DeleteAgent))
	mux.HandleFunc("GET /api/v1/lists", a.accountRead(a.boards.ListAllBuckets))
	// The inbox is a person's view of what every agent has said, so an agent
	// credential must not reach it: it would read other agents' messages.
	mux.HandleFunc("GET /api/v1/inbox", a.person(a.boards.ListInbox))
	mux.HandleFunc("POST /api/v1/lists", a.accountManage(a.boards.CreateBucket))
	mux.HandleFunc("POST /api/v1/lists/reorder", a.accountManage(a.boards.ReorderBuckets))
	mux.HandleFunc("GET /api/v1/lists/{id}", a.accountRead(a.boards.GetBucket))
	mux.HandleFunc("PATCH /api/v1/lists/{id}", a.accountManage(a.boards.UpdateBucket))
	mux.HandleFunc("DELETE /api/v1/lists/{id}", a.accountManage(a.boards.DeleteBucket))
	mux.HandleFunc("POST /api/v1/lists/{id}/tasks", a.accountManage(a.boards.CreateTask))
	mux.HandleFunc("POST /api/v1/lists/{id}/reorder-tasks", a.accountManage(a.boards.ReorderTasks))
	mux.HandleFunc("GET /api/v1/tasks", a.user(a.boards.ListTasks))
	mux.HandleFunc("POST /api/v1/tasks", a.accountManage(a.boards.CreateInboxTask))
	mux.HandleFunc("GET /api/v1/tasks/{id}", a.user(a.boards.GetTask))
	mux.HandleFunc("GET /api/v1/tasks/{id}/entries", a.user(a.boards.ListTaskEntries))
	mux.HandleFunc("POST /api/v1/tasks/{id}/entries", a.user(a.boards.CreateTaskEntry))
	mux.HandleFunc("GET /api/v1/tasks/{id}/subtasks", a.person(a.boards.ListSubtasks))
	mux.HandleFunc("POST /api/v1/tasks/{id}/subtasks", a.accountManage(a.boards.CreateSubtask))
	mux.HandleFunc("POST /api/v1/tasks/{id}/reorder-subtasks", a.accountManage(a.boards.ReorderSubtasks))
	mux.HandleFunc("PATCH /api/v1/tasks/{id}", a.user(a.boards.UpdateTask))
	mux.HandleFunc("POST /api/v1/tasks/{id}/move", a.accountManage(a.boards.MoveTask))
	mux.HandleFunc("PATCH /api/v1/tasks/{id}/status", a.session(a.boards.UpdateTaskStatus))
	mux.HandleFunc("DELETE /api/v1/tasks/{id}", a.accountManage(a.boards.DeleteTask))
	mux.HandleFunc("GET /api/v1/stats/summary", a.user(a.boards.GetWorkspaceSummary))
	mux.HandleFunc("GET /api/v1/agent/tasks", a.user(a.boards.AgentTasks))
	mux.HandleFunc("POST /api/v1/agent/tasks/{id}/claim", a.user(a.boards.AgentClaim))
	mux.HandleFunc("PATCH /api/v1/agent/tasks/{id}/status", a.user(a.boards.AgentStatus))
	mux.HandleFunc("POST /api/v1/agent/tasks/{id}/done", a.user(a.boards.AgentDone))
	mux.HandleFunc("GET /early-access", a.earlyAccess)
	mux.HandleFunc("GET /early-access/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/early-access/" {
			http.NotFound(w, r)
			return
		}
		a.earlyAccess(w, r)
	})
	mux.HandleFunc("GET /reset-password", a.resetPasswordPage)
	mux.Handle("/", StaticHandler(a.static))
	return mux
}

func (a *App) resetPasswordPage(w http.ResponseWriter, r *http.Request) {
	serveFile(w, r, a.static, "index.html")
}

func (a *App) earlyAccess(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil || !a.auth.SignupEnabled() {
		http.NotFound(w, r)
		return
	}
	serveFile(w, r, a.static, "index.html")
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	status := "not_configured"
	maxConnections := int32(0)
	connectionLimit := 0
	if a.db != nil {
		if err := a.db.Ping(r.Context()); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"code":  "service_unavailable",
				"error": "Database capacity is temporarily unavailable.",
			})
			return
		}
		status = "ok"
		maxConnections = a.db.MaxConnections()
		connectionLimit = a.db.ConnectionLimit()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "ok",
		"database": status,
		"capacity": map[string]any{
			"databaseMaxConnections":     maxConnections,
			"applicationConnectionLimit": connectionLimit,
		},
	})
}

func (a *App) me(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil {
		writeJSON(w, http.StatusOK, map[string]bool{"authenticated": false})
		return
	}
	result := a.authenticateWithLimits(r, false, false)
	if result.limitErr != nil {
		writeRateLimitDecision(w, ratelimit.Decision{}, result.limitErr)
		return
	}
	if result.limited {
		writeRateLimitDecision(w, result.decision, nil)
		return
	}
	if result.authErr != nil {
		if httpapi.WriteServiceUnavailable(w, result.authErr) {
			return
		}
		if !errors.Is(result.authErr, auth.ErrUnauthorized) {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "authentication failed"})
			return
		}
		if !a.allowPublicAuth(w, r) {
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"authenticated": false})
		return
	}
	if result.checked && !writeRateLimitDecision(w, result.decision, nil) {
		return
	}
	a.auth.MeForUser(w, r, result.user)
}

func (a *App) resolveAuthenticated(w http.ResponseWriter, r *http.Request, sessionOnly bool) (auth.User, bool) {
	result := a.authenticateWithLimits(r, sessionOnly, true)
	if result.limitErr != nil {
		writeRateLimitDecision(w, ratelimit.Decision{}, result.limitErr)
		return auth.User{}, false
	}
	if result.limited {
		writeRateLimitDecision(w, result.decision, nil)
		return auth.User{}, false
	}
	if result.authErr != nil {
		if httpapi.WriteServiceUnavailable(w, result.authErr) {
			return auth.User{}, false
		}
		if !errors.Is(result.authErr, auth.ErrUnauthorized) {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "authentication failed"})
			return auth.User{}, false
		}
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return auth.User{}, false
	}
	if result.checked && !writeRateLimitDecision(w, result.decision, nil) {
		return auth.User{}, false
	}
	return result.user, true
}

type authenticationResult struct {
	user     auth.User
	authErr  error
	decision ratelimit.Decision
	limitErr error
	checked  bool
	limited  bool
}

func (a *App) authenticateWithLimits(r *http.Request, sessionOnly bool, recordUnauthorizedOutcome bool) authenticationResult {
	if a.limits == nil {
		var user auth.User
		var err error
		if sessionOnly {
			user, _, err = a.auth.ResolveSessionUserFromRequest(r)
		} else {
			user, _, err = a.auth.ResolveUserFromRequest(r)
		}
		return authenticationResult{user: user, authErr: err}
	}
	staged, ok := a.limits.(ratelimit.AuthenticatedLimiter)
	if !ok {
		return authenticationResult{limitErr: errors.New("authenticated rate limiter is not configured")}
	}
	routeClass := authenticatedRouteClass(r)
	reservations := make(map[string]ratelimit.CredentialReservation, 2)
	var rejectedCredential string
	var lastCredential string
	var rejectedDecision ratelimit.Decision
	var gateErr error
	gate := func(credential string) bool {
		lastCredential = credential
		reservation, decision, err := staged.ReserveCredential(r.Context(), ratelimit.Key{Scope: ratelimit.ScopeCredential, Value: credential}, routeClass)
		if err != nil {
			gateErr = err
			return false
		}
		if !decision.Allowed {
			rejectedCredential = credential
			rejectedDecision = decision
			return false
		}
		reservations[credential] = reservation
		return true
	}
	var (
		user       auth.User
		credential string
		authErr    error
	)
	if sessionOnly {
		user, credential, authErr = a.auth.ResolveSessionUserFromRequestWithGate(r, gate)
	} else {
		user, credential, authErr = a.auth.ResolveUserFromRequestWithGate(r, gate)
	}
	cancelReservations := func(except string) error {
		for candidate, reservation := range reservations {
			if candidate == except {
				continue
			}
			if err := staged.CancelCredential(r.Context(), reservation); err != nil {
				return err
			}
		}
		return nil
	}
	if gateErr != nil {
		_ = cancelReservations("")
		return authenticationResult{limitErr: gateErr, checked: true}
	}
	if authErr == nil {
		if err := cancelReservations(credential); err != nil {
			return authenticationResult{limitErr: err, checked: true}
		}
		reservation, ok := reservations[credential]
		if !ok {
			return authenticationResult{limitErr: errors.New("credential reservation is missing"), checked: true}
		}
		account := ratelimit.Key{Scope: ratelimit.ScopeAccount, Value: user.ID}
		decision, err := staged.FinalizeCredential(r.Context(), reservation, &account)
		return authenticationResult{user: user, decision: decision, limitErr: err, checked: true, limited: err == nil && !decision.Allowed}
	}
	if !errors.Is(authErr, auth.ErrUnauthorized) && !errors.Is(authErr, auth.ErrCredentialRejected) {
		_ = cancelReservations("")
		return authenticationResult{authErr: authErr, checked: true}
	}
	for _, reservation := range reservations {
		if _, err := staged.FinalizeCredential(r.Context(), reservation, nil); err != nil {
			return authenticationResult{limitErr: err, checked: true}
		}
	}
	if rejectedCredential != "" {
		if err := staged.RecordCredentialOutcome(r.Context(), ratelimit.Key{Scope: ratelimit.ScopeCredential, Value: rejectedCredential}, routeClass, ratelimit.OutcomeRejected); err != nil {
			return authenticationResult{limitErr: err, checked: true}
		}
		return authenticationResult{authErr: auth.ErrCredentialRejected, decision: rejectedDecision, checked: true, limited: true}
	}
	if lastCredential != "" && recordUnauthorizedOutcome {
		if err := staged.RecordCredentialOutcome(r.Context(), ratelimit.Key{Scope: ratelimit.ScopeCredential, Value: lastCredential}, routeClass, ratelimit.OutcomeAllowed); err != nil {
			return authenticationResult{limitErr: err, checked: true}
		}
	}
	return authenticationResult{authErr: auth.ErrUnauthorized, checked: true}
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.ready(w) {
		return
	}
	a.auth.Login(w, r)
}

func (a *App) register(w http.ResponseWriter, r *http.Request) {
	if !a.ready(w) {
		return
	}
	a.auth.Register(w, r)
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	a.auth.Logout(w, r)
}

func (a *App) requestPasswordReset(w http.ResponseWriter, r *http.Request) {
	if !a.ready(w) {
		return
	}
	a.auth.RequestPasswordReset(w, r)
}

func (a *App) resetPassword(w http.ResponseWriter, r *http.Request) {
	if !a.ready(w) {
		return
	}
	a.auth.ResetPassword(w, r)
}

func (a *App) user(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.ready(w) {
			return
		}
		user, ok := a.resolveAuthenticated(w, r, false)
		if ok {
			next(w, r, user)
		}
	}
}

// accountRead accepts agent credentials, because an agent needs the same
// account context a person has to work on its own tasks. Handlers behind it
// must narrow their own results for agents, as ListTasks does.
func (a *App) accountRead(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return a.user(next)
}

// person accepts a browser session or a personal API token and rejects agent
// credentials. Use it for account-wide surfaces that belong to the human, where
// there is no per-agent narrowing to apply.
func (a *App) person(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return a.user(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if user.AgentID != "" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "agent credentials cannot read account-wide data"})
			return
		}
		next(w, r, user)
	})
}

func (a *App) accountManage(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return a.user(func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if user.AgentID != "" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "agent credentials cannot manage account resources"})
			return
		}
		next(w, r, user)
	})
}

func (a *App) session(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.ready(w) {
			return
		}
		user, ok := a.resolveAuthenticated(w, r, true)
		if ok {
			next(w, r, user)
		}
	}
}

func (a *App) publicAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.allowPublicAuth(w, r) {
			return
		}
		next(w, r)
	}
}

func (a *App) allowPublicAuth(w http.ResponseWriter, r *http.Request) bool {
	if a.limits == nil {
		return true
	}
	decision, err := a.limits.Allow(r.Context(), []ratelimit.Key{{Scope: ratelimit.ScopeIP, Value: auth.RateLimitIPKey(r)}}, ratelimit.ClassPublicAuth)
	return writeRateLimitDecision(w, decision, err)
}

func authenticatedRouteClass(r *http.Request) string {
	routeClass := ratelimit.ClassAuthenticatedWrite
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		routeClass = ratelimit.ClassAuthenticatedRead
	}
	return routeClass
}

func writeRateLimitDecision(w http.ResponseWriter, decision ratelimit.Decision, err error) bool {
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"code":  "rate_limit_unavailable",
			"error": "Request capacity could not be checked.",
		})
		return false
	}
	w.Header().Set("RateLimit-Limit", strconv.Itoa(decision.Limit))
	w.Header().Set("RateLimit-Remaining", strconv.Itoa(decision.Remaining))
	if decision.Allowed {
		return true
	}
	retrySeconds := ratelimit.RetryAfterSeconds(decision.RetryAfter)
	w.Header().Set("Retry-After", strconv.Itoa(retrySeconds))
	writeJSON(w, http.StatusTooManyRequests, map[string]string{
		"code":  "rate_limit_exceeded",
		"error": "Too many requests. Retry later.",
	})
	return false
}

func (a *App) ready(w http.ResponseWriter) bool {
	if a.auth == nil || a.boards == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "database is not configured"})
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
