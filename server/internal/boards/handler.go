package boards

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/owainlewis/slate.do/server/internal/auth"
)

type Handler struct {
	store *Store
}

func NewHandler(store *Store) *Handler {
	return &Handler{store: store}
}

func (h *Handler) ListBoards(w http.ResponseWriter, r *http.Request, user auth.User) {
	boards, err := h.store.ListBoards(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "boards could not be loaded")
		return
	}
	if boards == nil {
		boards = []Board{}
	}
	writeJSON(w, http.StatusOK, map[string][]Board{"boards": boards})
}

func (h *Handler) CreateBoard(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input CreateBoardInput
	if !decodeJSON(w, r, &input) {
		return
	}
	board, err := h.store.CreateBoard(r.Context(), user.ID, input)
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, board)
}

func (h *Handler) GetBoard(w http.ResponseWriter, r *http.Request, user auth.User) {
	board, err := h.store.GetBoard(r.Context(), user.ID, r.PathValue("id"))
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, board)
}

func (h *Handler) UpdateBoard(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input UpdateBoardInput
	if !decodeJSON(w, r, &input) {
		return
	}
	board, err := h.store.UpdateBoard(r.Context(), user.ID, r.PathValue("id"), input)
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, board)
}

func (h *Handler) DeleteBoard(w http.ResponseWriter, r *http.Request, user auth.User) {
	err := h.store.DeleteBoard(r.Context(), user.ID, r.PathValue("id"))
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) CreateBucket(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input CreateBucketInput
	if !decodeJSON(w, r, &input) {
		return
	}
	bucket, err := h.store.CreateBucket(r.Context(), user.ID, r.PathValue("id"), input)
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, bucket)
}

func (h *Handler) UpdateBucket(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input UpdateBucketInput
	if !decodeJSON(w, r, &input) {
		return
	}
	bucket, err := h.store.UpdateBucket(r.Context(), user.ID, r.PathValue("id"), input)
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, bucket)
}

func (h *Handler) DeleteBucket(w http.ResponseWriter, r *http.Request, user auth.User) {
	err := h.store.DeleteBucket(r.Context(), user.ID, r.PathValue("id"))
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) ReorderBuckets(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input reorderInput
	if !decodeJSON(w, r, &input) {
		return
	}
	err := h.store.ReorderBuckets(r.Context(), user.ID, r.PathValue("id"), input.IDs)
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) CreateTask(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input CreateTaskInput
	if !decodeJSON(w, r, &input) {
		return
	}
	task, err := h.store.CreateTask(r.Context(), user.ID, r.PathValue("id"), input)
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

func (h *Handler) GetTask(w http.ResponseWriter, r *http.Request, user auth.User) {
	task, err := h.store.GetTask(r.Context(), user.ID, r.PathValue("id"))
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *Handler) UpdateTask(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input UpdateTaskInput
	if !decodeJSON(w, r, &input) {
		return
	}
	task, err := h.store.UpdateTask(r.Context(), user.ID, r.PathValue("id"), input)
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *Handler) DeleteTask(w http.ResponseWriter, r *http.Request, user auth.User) {
	err := h.store.DeleteTask(r.Context(), user.ID, r.PathValue("id"))
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) ReorderTasks(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input reorderInput
	if !decodeJSON(w, r, &input) {
		return
	}
	err := h.store.ReorderTasks(r.Context(), user.ID, r.PathValue("id"), input.IDs)
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) ListTasks(w http.ResponseWriter, r *http.Request, user auth.User) {
	filter := taskFilterFromQuery(r)
	tasks, err := h.store.ListTasks(r.Context(), user.ID, filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "tasks could not be loaded")
		return
	}
	if tasks == nil {
		tasks = []Task{}
	}
	writeJSON(w, http.StatusOK, map[string][]Task{"tasks": tasks})
}

func (h *Handler) AgentTasks(w http.ResponseWriter, r *http.Request, user auth.User) {
	filter := taskFilterFromQuery(r)
	if filter.Assignee == "" {
		writeError(w, http.StatusBadRequest, "assignee is required")
		return
	}
	done := false
	if filter.Done == nil {
		filter.Done = &done
	}
	if filter.Status == "" {
		filter.Status = StatusQueued
	}
	tasks, err := h.store.ListTasks(r.Context(), user.ID, filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "agent tasks could not be loaded")
		return
	}
	if tasks == nil {
		tasks = []Task{}
	}
	writeJSON(w, http.StatusOK, map[string][]Task{"tasks": tasks})
}

func (h *Handler) AgentClaim(w http.ResponseWriter, r *http.Request, user auth.User) {
	status := StatusWorking
	task, err := h.store.UpdateTask(r.Context(), user.ID, r.PathValue("id"), UpdateTaskInput{Status: &status})
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *Handler) AgentNote(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input struct {
		Notes string `json:"notes"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	task, err := h.store.UpdateTask(r.Context(), user.ID, r.PathValue("id"), UpdateTaskInput{Notes: &input.Notes})
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *Handler) AgentStatus(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input struct {
		Status string `json:"status"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	task, err := h.store.UpdateTask(r.Context(), user.ID, r.PathValue("id"), UpdateTaskInput{Status: &input.Status})
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *Handler) AgentDone(w http.ResponseWriter, r *http.Request, user auth.User) {
	status := StatusDone
	done := true
	task, err := h.store.UpdateTask(r.Context(), user.ID, r.PathValue("id"), UpdateTaskInput{Status: &status, Done: &done})
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func taskFilterFromQuery(r *http.Request) TaskFilter {
	q := r.URL.Query()
	filter := TaskFilter{
		BoardID:  strings.TrimSpace(q.Get("boardId")),
		Assignee: strings.TrimSpace(q.Get("assignee")),
		Status:   strings.TrimSpace(q.Get("status")),
	}
	if raw := strings.TrimSpace(q.Get("done")); raw != "" {
		done := raw == "true" || raw == "1"
		filter.Done = &done
	}
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		if limit, err := strconv.Atoi(raw); err == nil {
			filter.Limit = limit
		}
	}
	return filter
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

func handleStoreError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, ErrLimitFull):
		writeError(w, http.StatusConflict, "bucket limit reached")
	case errors.Is(err, ErrInvalidData):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		slog.Error("board API request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "request failed")
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

type reorderInput struct {
	IDs []string `json:"ids"`
}
