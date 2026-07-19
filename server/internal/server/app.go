package server

import (
	"encoding/json"
	"io/fs"
	"net/http"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/boards"
	"github.com/owainlewis/slate.do/server/internal/database"
)

type App struct {
	static fs.FS
	db     *database.Pool
	auth   *auth.Service
	boards *boards.Handler
}

func NewApp(static fs.FS, db *database.Pool, cookieSecure bool) *App {
	app := &App{static: static, db: db}
	if db != nil {
		authStore := auth.NewPGStore(db)
		app.auth = auth.NewService(authStore, cookieSecure)
		app.boards = boards.NewHandler(boards.NewStore(db))
	}
	return app
}

func (a *App) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/v1/me", a.me)
	mux.HandleFunc("PATCH /api/v1/me", a.session(a.auth.UpdateTheme))
	mux.HandleFunc("POST /api/v1/auth/login", a.login)
	mux.HandleFunc("POST /api/v1/auth/logout", a.logout)
	mux.HandleFunc("GET /api/v1/api-tokens", a.session(a.auth.ListAPITokens))
	mux.HandleFunc("POST /api/v1/api-tokens", a.session(a.auth.CreateAPIToken))
	mux.HandleFunc("DELETE /api/v1/api-tokens/{id}", a.session(a.auth.RevokeAPIToken))
	mux.HandleFunc("GET /api/v1/boards", a.user(a.boards.ListBoards))
	mux.HandleFunc("POST /api/v1/boards", a.user(a.boards.CreateBoard))
	mux.HandleFunc("GET /api/v1/boards/{id}", a.user(a.boards.GetBoard))
	mux.HandleFunc("PATCH /api/v1/boards/{id}", a.user(a.boards.UpdateBoard))
	mux.HandleFunc("DELETE /api/v1/boards/{id}", a.user(a.boards.DeleteBoard))
	mux.HandleFunc("POST /api/v1/boards/{id}/buckets", a.user(a.boards.CreateBucket))
	mux.HandleFunc("POST /api/v1/boards/{id}/reorder-buckets", a.user(a.boards.ReorderBuckets))
	mux.HandleFunc("GET /api/v1/buckets/{id}", a.user(a.boards.GetBucket))
	mux.HandleFunc("PATCH /api/v1/buckets/{id}", a.user(a.boards.UpdateBucket))
	mux.HandleFunc("DELETE /api/v1/buckets/{id}", a.user(a.boards.DeleteBucket))
	mux.HandleFunc("POST /api/v1/buckets/{id}/tasks", a.user(a.boards.CreateTask))
	mux.HandleFunc("POST /api/v1/buckets/{id}/reorder-tasks", a.user(a.boards.ReorderTasks))
	mux.HandleFunc("GET /api/v1/tasks", a.user(a.boards.ListTasks))
	mux.HandleFunc("GET /api/v1/tasks/{id}", a.user(a.boards.GetTask))
	mux.HandleFunc("PATCH /api/v1/tasks/{id}", a.user(a.boards.UpdateTask))
	mux.HandleFunc("PATCH /api/v1/tasks/{id}/status", a.session(a.boards.UpdateTaskStatus))
	mux.HandleFunc("DELETE /api/v1/tasks/{id}", a.user(a.boards.DeleteTask))
	mux.HandleFunc("GET /api/v1/agent/tasks", a.user(a.boards.AgentTasks))
	mux.HandleFunc("POST /api/v1/agent/tasks/{id}/claim", a.user(a.boards.AgentClaim))
	mux.HandleFunc("PATCH /api/v1/agent/tasks/{id}/status", a.user(a.boards.AgentStatus))
	mux.HandleFunc("POST /api/v1/agent/tasks/{id}/done", a.user(a.boards.AgentDone))
	mux.Handle("/", StaticHandler(a.static))
	return mux
}

func (a *App) health(w http.ResponseWriter, r *http.Request) {
	status := "not_configured"
	if a.db != nil {
		status = "ok"
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":   "ok",
		"database": status,
	})
}

func (a *App) me(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil {
		writeJSON(w, http.StatusOK, map[string]bool{"authenticated": false})
		return
	}
	a.auth.Me(w, r)
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.ready(w) {
		return
	}
	a.auth.Login(w, r)
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	a.auth.Logout(w, r)
}

func (a *App) user(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.ready(w) {
			return
		}
		a.auth.RequireUser(next)(w, r)
	}
}

func (a *App) session(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.ready(w) {
			return
		}
		a.auth.RequireSessionUser(next)(w, r)
	}
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
