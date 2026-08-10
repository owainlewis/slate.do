package agents

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/httpapi"
)

type detailStore interface {
	GetDetail(context.Context, string, string) (Detail, error)
	ListWork(context.Context, string, string, int, int) (WorkPage, error)
	UpdateAgent(context.Context, string, string, string, string) (auth.AgentUser, error)
	RotateCredential(context.Context, string, string, string, string, string) (auth.AgentCredential, bool, error)
	RevokeCredential(context.Context, string, string) error
	ArchiveAgent(context.Context, string, string, bool) (ArchiveConflict, error)
	RestoreAgent(context.Context, string, string) (auth.AgentUser, error)
	DeleteAgent(context.Context, string, string) error
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
		writeInternalError(w, err, "agent details could not be loaded")
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
		writeInternalError(w, err, "assigned work could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, work)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !validateMutation(w, r) {
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
	purpose := strings.TrimSpace(input.Purpose)
	if displayName == "" {
		writeError(w, http.StatusBadRequest, "agent name is required")
		return
	}
	if !httpapi.RuneLimit(w, "displayName", displayName, httpapi.AgentNameRunes) {
		return
	}
	if !httpapi.ByteLimit(w, "purpose", purpose, httpapi.AgentInstructionsBytes) {
		return
	}
	agent, err := h.store.UpdateAgent(r.Context(), user.ID, agentID(r), displayName, purpose)
	switch {
	case errors.Is(err, auth.ErrAgentNotFound):
		writeError(w, http.StatusNotFound, "agent not found")
	case errors.Is(err, auth.ErrAgentNameTaken):
		writeCodedError(w, http.StatusConflict, "agent_name_taken", "An active agent with that name already exists.")
	case err != nil:
		writeInternalError(w, err, "agent settings could not be saved")
	default:
		writeJSON(w, http.StatusOK, agent)
	}
}

func (h *Handler) RotateCredential(w http.ResponseWriter, r *http.Request, user auth.User) {
	w.Header().Set("Cache-Control", "no-store")
	if !validateMutation(w, r) {
		return
	}
	var input struct {
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	key := strings.TrimSpace(input.IdempotencyKey)
	if !httpapi.ByteLimit(w, "idempotencyKey", key, httpapi.AgentRotationKeyBytes) {
		return
	}
	if len(key) < 16 {
		writeError(w, http.StatusBadRequest, "a stable idempotency key is required")
		return
	}
	plain, err := randomAgentToken()
	if err != nil {
		writeInternalError(w, err, "credential could not be rotated")
		return
	}
	sum := sha256.Sum256([]byte(plain))
	credential, applied, err := h.store.RotateCredential(r.Context(), user.ID, agentID(r), key, fmt.Sprintf("%x", sum[:]), tokenDisplayPrefix(plain))
	switch {
	case errors.Is(err, auth.ErrAgentNotFound):
		writeError(w, http.StatusNotFound, "agent not found")
	case errors.Is(err, ErrIdempotencyConflict):
		writeCodedError(w, http.StatusConflict, "idempotency_conflict", "This rotation key was already used for another agent.")
	case err != nil:
		writeInternalError(w, err, "credential could not be rotated")
	default:
		token := ""
		if applied {
			token = plain
		}
		writeJSON(w, http.StatusOK, struct {
			Token          string `json:"token,omitempty"`
			AlreadyApplied bool   `json:"alreadyApplied"`
			auth.AgentCredential
		}{
			Token:           token,
			AlreadyApplied:  !applied,
			AgentCredential: credential,
		})
	}
}

func (h *Handler) RevokeCredential(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !validateMutation(w, r) {
		return
	}
	err := h.store.RevokeCredential(r.Context(), user.ID, agentID(r))
	switch {
	case errors.Is(err, auth.ErrAgentNotFound):
		writeError(w, http.StatusNotFound, "agent not found")
	case err != nil:
		writeInternalError(w, err, "credential could not be revoked")
	default:
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func (h *Handler) Archive(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !validateMutation(w, r) {
		return
	}
	var input struct {
		UnassignOpenWork bool `json:"unassignOpenWork"`
	}
	if r.Method != http.MethodDelete && !decodeJSON(w, r, &input) {
		return
	}
	counts, err := h.store.ArchiveAgent(r.Context(), user.ID, agentID(r), input.UnassignOpenWork)
	var conflict *ArchiveConflictError
	switch {
	case errors.Is(err, auth.ErrAgentNotFound):
		writeError(w, http.StatusNotFound, "agent not found")
	case errors.As(err, &conflict):
		writeJSON(w, http.StatusConflict, struct {
			Code     string          `json:"code"`
			Error    string          `json:"error"`
			Conflict ArchiveConflict `json:"conflict"`
		}{
			Code:     "agent_open_work",
			Error:    "New, Ready, and In Progress work must be unassigned before this agent can be archived.",
			Conflict: conflict.Counts,
		})
	case err != nil:
		writeInternalError(w, err, "agent could not be archived")
	default:
		writeJSON(w, http.StatusOK, struct {
			OK bool `json:"ok"`
			ArchiveConflict
		}{OK: true, ArchiveConflict: counts})
	}
}

func (h *Handler) Restore(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !validateMutation(w, r) {
		return
	}
	agent, err := h.store.RestoreAgent(r.Context(), user.ID, agentID(r))
	switch {
	case errors.Is(err, auth.ErrAgentNotFound):
		writeError(w, http.StatusNotFound, "agent not found")
	case errors.Is(err, ErrRestoreLimit):
		writeCodedError(w, http.StatusConflict, "agent_limit_reached", "Archive an active agent before restoring this identity.")
	case errors.Is(err, ErrRestoreNameTaken):
		writeCodedError(w, http.StatusConflict, "agent_name_taken", "An active agent with that name already exists. Rename this identity before restoring it.")
	case errors.Is(err, auth.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, "authentication required")
	case err != nil:
		writeInternalError(w, err, "agent could not be restored")
	default:
		writeJSON(w, http.StatusOK, agent)
	}
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request, user auth.User) {
	if !validateMutation(w, r) {
		return
	}
	err := h.store.DeleteAgent(r.Context(), user.ID, agentID(r))
	switch {
	case errors.Is(err, auth.ErrAgentNotFound):
		writeError(w, http.StatusNotFound, "agent not found")
	case errors.Is(err, ErrDeleteRequiresArchive):
		writeCodedError(w, http.StatusConflict, "agent_not_archived", "Archive this agent before permanently deleting it.")
	case err != nil:
		writeInternalError(w, err, "agent could not be deleted")
	default:
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func agentID(r *http.Request) string {
	return strings.TrimSpace(r.PathValue("id"))
}

func randomAgentToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "slate_agent_" + base64.RawURLEncoding.EncodeToString(raw), nil
}

func tokenDisplayPrefix(token string) string {
	const displayLength = 24
	if len(token) <= displayLength {
		return token
	}
	return token[:displayLength]
}

func validateMutation(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || r.Host == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") &&
		strings.EqualFold(parsed.Host, r.Host) && parsed.User == nil {
		return true
	}
	writeError(w, http.StatusForbidden, "cross-origin request blocked")
	return false
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	return httpapi.DecodeJSON(w, r, target)
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

func writeInternalError(w http.ResponseWriter, err error, message string) {
	if httpapi.WriteServiceUnavailable(w, err) {
		return
	}
	writeError(w, http.StatusInternalServerError, message)
}

func writeCodedError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, map[string]string{"code": code, "error": message})
}
