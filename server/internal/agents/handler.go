package agents

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/owainlewis/slate.do/server/internal/auth"
)

type detailStore interface {
	GetDetail(context.Context, string, string) (Detail, error)
	ListWork(context.Context, string, string, int, int) (WorkPage, error)
}

type Handler struct {
	store detailStore
}

func NewHandler(store detailStore) *Handler {
	return &Handler{store: store}
}

func (h *Handler) GetDetail(w http.ResponseWriter, r *http.Request, user auth.User) {
	agentID := strings.TrimSpace(r.PathValue("id"))
	if agentID == "" {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}
	detail, err := h.store.GetDetail(r.Context(), user.ID, agentID)
	if IsNotFound(err) {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "agent details could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (h *Handler) ListWork(w http.ResponseWriter, r *http.Request, user auth.User) {
	agentID := strings.TrimSpace(r.PathValue("id"))
	if agentID == "" {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}
	page, err := positiveQueryInt(r, "page", 1, 100000)
	if err != nil {
		writeError(w, http.StatusBadRequest, "page must be a positive integer")
		return
	}
	pageSize, err := positiveQueryInt(r, "pageSize", MaxPageSize, MaxPageSize)
	if err != nil {
		writeError(w, http.StatusBadRequest, "pageSize must be between 1 and 50")
		return
	}
	work, err := h.store.ListWork(r.Context(), user.ID, agentID, page, pageSize)
	if IsNotFound(err) {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assigned work could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, work)
}

func positiveQueryInt(r *http.Request, name string, fallback int, maximum int) (int, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 || value > maximum {
		return 0, strconv.ErrSyntax
	}
	return value, nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
