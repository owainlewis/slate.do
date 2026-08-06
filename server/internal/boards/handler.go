package boards

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/entitlements"
	"github.com/owainlewis/slate.do/server/internal/httpapi"
)

type Handler struct {
	store *Store
}

func NewHandler(store *Store) *Handler {
	return &Handler{store: store}
}

func (h *Handler) ListBoards(w http.ResponseWriter, r *http.Request, user auth.User) {
	var listed []Board
	var err error
	if user.AgentID != "" {
		listed, err = h.store.ListBoardsForAgent(r.Context(), user.ID, user.AgentID)
	} else {
		listed, err = h.store.ListBoards(r.Context(), user.ID)
	}
	if err != nil {
		writeInternalError(w, err, "boards could not be loaded")
		return
	}
	if listed == nil {
		listed = []Board{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"boards": listed, "maxBoards": user.Entitlement.Limits.Boards})
}

func (h *Handler) ListAllBuckets(w http.ResponseWriter, r *http.Request, user auth.User) {
	if user.AgentID != "" {
		writeError(w, http.StatusForbidden, "agent credentials cannot list workspace lists")
		return
	}
	lists, err := h.store.ListAllBuckets(r.Context(), user.ID)
	if err != nil {
		writeInternalError(w, err, "lists could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lists": lists})
}

func (h *Handler) CreateBoard(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input CreateBoardInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if !validateCreateBoardText(w, input) {
		return
	}
	board, err := h.store.CreateBoard(r.Context(), user.ID, input)
	if handleStoreError(w, err, user.Entitlement) {
		return
	}
	writeJSON(w, http.StatusCreated, board)
}

func (h *Handler) GetBoard(w http.ResponseWriter, r *http.Request, user auth.User) {
	var board Board
	var err error
	if user.AgentID != "" {
		board, err = h.store.GetBoardForAgent(r.Context(), user.ID, user.AgentID, r.PathValue("id"))
	} else {
		board, err = h.store.GetBoard(r.Context(), user.ID, r.PathValue("id"))
	}
	if handleStoreError(w, err, user.Entitlement) {
		return
	}
	writeJSON(w, http.StatusOK, board)
}

func (h *Handler) UpdateBoard(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input UpdateBoardInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if !validateUpdateBoardText(w, input) {
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
	if !validateCreateBucketText(w, input) {
		return
	}
	bucket, err := h.store.CreateBucket(r.Context(), user.ID, r.PathValue("id"), input)
	if handleStoreError(w, err, user.Entitlement) {
		return
	}
	writeJSON(w, http.StatusCreated, bucket)
}

func (h *Handler) GetBucket(w http.ResponseWriter, r *http.Request, user auth.User) {
	var bucket Bucket
	var err error
	if user.AgentID != "" {
		bucket, err = h.store.GetBucketForAgent(r.Context(), user.ID, user.AgentID, r.PathValue("id"))
	} else {
		bucket, err = h.store.GetBucket(r.Context(), user.ID, r.PathValue("id"))
	}
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, bucket)
}

func (h *Handler) UpdateBucket(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input UpdateBucketInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if !validateUpdateBucketText(w, input) {
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
	if !validateCreateTaskText(w, input) {
		return
	}
	input.IdempotencyKey = strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if !validateTaskIdempotencyKey(w, input.IdempotencyKey) {
		return
	}
	task, err := h.store.CreateTask(r.Context(), user.ID, r.PathValue("id"), input)
	if handleStoreError(w, err, user.Entitlement) {
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

func (h *Handler) CreateInboxTask(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input CreateTaskInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if !validateCreateTaskText(w, input) {
		return
	}
	input.IdempotencyKey = strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if !validateTaskIdempotencyKey(w, input.IdempotencyKey) {
		return
	}
	task, err := h.store.CreateInboxTask(r.Context(), user.ID, input)
	if handleStoreError(w, err, user.Entitlement) {
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

func (h *Handler) CreateSubtask(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input CreateTaskInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if !validateCreateTaskText(w, input) {
		return
	}
	input.IdempotencyKey = strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if !validateTaskIdempotencyKey(w, input.IdempotencyKey) {
		return
	}
	task, err := h.store.CreateSubtask(r.Context(), user.ID, r.PathValue("id"), input)
	if handleStoreError(w, err, user.Entitlement) {
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

func (h *Handler) GetTask(w http.ResponseWriter, r *http.Request, user auth.User) {
	var task Task
	var err error
	if user.AgentID != "" {
		task, err = h.store.GetTaskForAgent(r.Context(), user.ID, user.AgentID, r.PathValue("id"))
	} else {
		task, err = h.store.GetTask(r.Context(), user.ID, r.PathValue("id"))
	}
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
	if !validateUpdateTaskText(w, input) {
		return
	}
	var task Task
	var err error
	if user.AgentID != "" {
		task, err = h.store.UpdateTaskForAgent(r.Context(), user.ID, user.AgentID, r.PathValue("id"), input)
	} else {
		task, err = h.store.UpdateTask(r.Context(), user.ID, r.PathValue("id"), input)
	}
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *Handler) MoveTask(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input MoveTaskInput
	if !decodeJSON(w, r, &input) {
		return
	}
	task, err := h.store.MoveTask(r.Context(), user.ID, r.PathValue("id"), input)
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *Handler) UpdateTaskStatus(w http.ResponseWriter, r *http.Request, user auth.User) {
	var input struct {
		Title           *string `json:"title"`
		Description     *string `json:"description"`
		ScheduledDate   *string `json:"scheduledDate"`
		Kind            *string `json:"kind"`
		BucketID        *string `json:"bucketId"`
		Status          *string `json:"status"`
		Priority        *string `json:"priority"`
		AssigneeAgentID *string `json:"assigneeAgentId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Status == nil {
		writeError(w, http.StatusBadRequest, "status is required")
		return
	}
	update := UpdateTaskInput{
		Title: input.Title, Description: input.Description, ScheduledDate: input.ScheduledDate,
		Kind: input.Kind, BucketID: input.BucketID, Status: input.Status, Priority: input.Priority,
		AssigneeAgentID: input.AssigneeAgentID,
	}
	if !validateUpdateTaskText(w, update) {
		return
	}
	task, err := h.store.UpdateTaskForHuman(r.Context(), user.ID, r.PathValue("id"), update)
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
	filter, err := taskFilterFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if user.AgentID != "" {
		filter.AssigneeAgentID = user.AgentID
		filter.Unassigned = false
	}
	page, err := h.store.ListTaskPage(r.Context(), user.ID, filter)
	if err != nil {
		if errors.Is(err, ErrInvalidData) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeInternalError(w, err, "tasks could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h *Handler) AgentTasks(w http.ResponseWriter, r *http.Request, user auth.User) {
	filter, err := taskFilterFromQuery(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	done := false
	if filter.Done == nil {
		filter.Done = &done
	}
	if filter.Status == "" {
		filter.Status = StatusQueued
	}
	filter.ActionsOnly = true
	if user.AgentID != "" {
		filter.AssigneeAgentID = user.AgentID
	}
	page, err := h.store.ListTaskPage(r.Context(), user.ID, filter)
	if err != nil {
		if errors.Is(err, ErrInvalidData) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeInternalError(w, err, "tasks could not be loaded")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h *Handler) AgentClaim(w http.ResponseWriter, r *http.Request, user auth.User) {
	var task Task
	var err error
	if user.AgentID != "" {
		task, err = h.store.ClaimTaskForAgent(r.Context(), user.ID, user.AgentID, r.PathValue("id"))
	} else {
		task, err = h.store.ClaimTask(r.Context(), user.ID, r.PathValue("id"))
	}
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
	var task Task
	var err error
	if user.AgentID != "" {
		task, err = h.store.UpdateTaskForAgent(r.Context(), user.ID, user.AgentID, r.PathValue("id"), UpdateTaskInput{Status: &input.Status})
	} else {
		task, err = h.store.UpdateTask(r.Context(), user.ID, r.PathValue("id"), UpdateTaskInput{Status: &input.Status})
	}
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *Handler) AgentDone(w http.ResponseWriter, r *http.Request, user auth.User) {
	status := StatusDone
	done := true
	var task Task
	var err error
	if user.AgentID != "" {
		task, err = h.store.UpdateTaskForAgent(r.Context(), user.ID, user.AgentID, r.PathValue("id"), UpdateTaskInput{Status: &status, Done: &done})
	} else {
		task, err = h.store.UpdateTask(r.Context(), user.ID, r.PathValue("id"), UpdateTaskInput{Status: &status, Done: &done})
	}
	if handleStoreError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func taskFilterFromQuery(r *http.Request) (TaskFilter, error) {
	q := r.URL.Query()
	filter := TaskFilter{
		BoardID:       strings.TrimSpace(q.Get("boardId")),
		BucketID:      strings.TrimSpace(q.Get("bucketId")),
		Status:        strings.TrimSpace(q.Get("status")),
		Priority:      strings.TrimSpace(q.Get("priority")),
		Cursor:        strings.TrimSpace(q.Get("cursor")),
		Query:         strings.TrimSpace(q.Get("q")),
		ScheduledFrom: strings.TrimSpace(q.Get("plannedFrom")),
		ScheduledTo:   strings.TrimSpace(q.Get("plannedTo")),
		ParentTaskID:  strings.TrimSpace(q.Get("parentTaskId")),
	}
	if err := validateTaskFilterLocationIDs(filter); err != nil {
		return TaskFilter{}, err
	}
	assignee := strings.TrimSpace(q.Get("assigneeAgentId"))
	if assignee == "unassigned" {
		filter.Unassigned = true
	} else {
		filter.AssigneeAgentID = assignee
	}
	if filter.AssigneeAgentID != "" && !validUUID(filter.AssigneeAgentID) {
		return TaskFilter{}, errors.New("assigneeAgentId must be a valid ID")
	}
	if filter.ParentTaskID != "" && !validUUID(filter.ParentTaskID) {
		return TaskFilter{}, errors.New("parentTaskId must be a valid ID")
	}
	if filter.ScheduledFrom != "" {
		if _, err := validDate(filter.ScheduledFrom); err != nil {
			return TaskFilter{}, errors.New("plannedFrom must be YYYY-MM-DD")
		}
	}
	if filter.ScheduledTo != "" {
		if _, err := validDate(filter.ScheduledTo); err != nil {
			return TaskFilter{}, errors.New("plannedTo must be YYYY-MM-DD")
		}
	}
	if raw := strings.TrimSpace(q.Get("topLevel")); raw != "" {
		topLevel, err := parseQueryBool("topLevel", raw)
		if err != nil {
			return TaskFilter{}, err
		}
		filter.TopLevelOnly = *topLevel
	}
	if raw := strings.TrimSpace(q.Get("inbox")); raw != "" {
		inboxOnly, err := parseQueryBool("inbox", raw)
		if err != nil {
			return TaskFilter{}, err
		}
		filter.InboxOnly = *inboxOnly
	}
	if raw := strings.TrimSpace(q.Get("done")); raw != "" {
		done, err := parseQueryBool("done", raw)
		if err != nil {
			return TaskFilter{}, err
		}
		filter.Done = done
	}
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 {
			return TaskFilter{}, errors.New("limit must be a positive integer")
		}
		filter.Limit = limit
	}
	return filter, nil
}

func validateTaskFilterLocationIDs(filter TaskFilter) error {
	if filter.BoardID != "" && !validUUID(filter.BoardID) {
		return errors.New("boardId must be a valid ID")
	}
	if filter.BucketID != "" && !validUUID(filter.BucketID) {
		return errors.New("bucketId must be a valid ID")
	}
	return nil
}

func parseQueryBool(name string, raw string) (*bool, error) {
	var value bool
	switch strings.ToLower(raw) {
	case "true", "1":
		value = true
	case "false", "0":
		value = false
	default:
		return nil, fmt.Errorf("%s must be true or false", name)
	}
	return &value, nil
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	return httpapi.DecodeJSON(w, r, target)
}

func validateCreateBoardText(w http.ResponseWriter, input CreateBoardInput) bool {
	return httpapi.RuneLimit(w, "name", strings.TrimSpace(input.Name), httpapi.BoardNameRunes) &&
		httpapi.RuneLimit(w, "backgroundKind", strings.TrimSpace(input.BackgroundKind), httpapi.BoardBackgroundKind) &&
		httpapi.RuneLimit(w, "backgroundValue", input.BackgroundValue, httpapi.BoardBackgroundRunes)
}

func validateUpdateBoardText(w http.ResponseWriter, input UpdateBoardInput) bool {
	return optionalRuneLimit(w, "name", input.Name, httpapi.BoardNameRunes, true) &&
		optionalRuneLimit(w, "backgroundKind", input.BackgroundKind, httpapi.BoardBackgroundKind, true) &&
		optionalRuneLimit(w, "backgroundValue", input.BackgroundValue, httpapi.BoardBackgroundRunes, false)
}

func validateCreateBucketText(w http.ResponseWriter, input CreateBucketInput) bool {
	return httpapi.RuneLimit(w, "name", strings.TrimSpace(input.Name), httpapi.ListNameRunes) &&
		httpapi.ByteLimit(w, "goal", input.Goal, httpapi.ListGoalBytes)
}

func validateUpdateBucketText(w http.ResponseWriter, input UpdateBucketInput) bool {
	return optionalRuneLimit(w, "name", input.Name, httpapi.ListNameRunes, true) &&
		optionalByteLimit(w, "goal", input.Goal, httpapi.ListGoalBytes)
}

func validateCreateTaskText(w http.ResponseWriter, input CreateTaskInput) bool {
	return httpapi.RuneLimit(w, "title", strings.TrimSpace(input.Title), httpapi.TaskTitleRunes) &&
		httpapi.ByteLimit(w, "description", input.Description, httpapi.TaskDescriptionBytes)
}

func validateUpdateTaskText(w http.ResponseWriter, input UpdateTaskInput) bool {
	return optionalRuneLimit(w, "title", input.Title, httpapi.TaskTitleRunes, true) &&
		optionalByteLimit(w, "description", input.Description, httpapi.TaskDescriptionBytes)
}

func validateTaskIdempotencyKey(w http.ResponseWriter, key string) bool {
	return httpapi.ByteLimit(w, "Idempotency-Key", strings.TrimSpace(key), httpapi.TaskIdempotencyBytes)
}

func optionalRuneLimit(w http.ResponseWriter, field string, value *string, limit int, trim bool) bool {
	if value == nil {
		return true
	}
	checked := *value
	if trim {
		checked = strings.TrimSpace(checked)
	}
	return httpapi.RuneLimit(w, field, checked, limit)
}

func optionalByteLimit(w http.ResponseWriter, field string, value *string, limit int) bool {
	return value == nil || httpapi.ByteLimit(w, field, *value, limit)
}

func handleStoreError(w http.ResponseWriter, err error, account ...entitlements.Entitlement) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, ErrLimitFull):
		writeLimitError(w, "working_limit_reached", "This list's working limit has been reached.")
	case errors.Is(err, ErrBoardLimit):
		plan, code, limit := limitContext(account, func(l entitlements.Limits) int { return l.Boards }, defaultMaxBoards)
		writeLimitError(w, code+"_board_limit_reached", fmt.Sprintf("%s allows up to %d %s.", plan, limit, plural(limit, "board", "boards")))
	case errors.Is(err, ErrListLimit):
		plan, code, limit := limitContext(account, func(l entitlements.Limits) int { return l.ListsPerBoard }, defaultMaxListsPerBoard)
		writeLimitError(w, code+"_list_limit_reached", fmt.Sprintf("%s allows up to %d lists per board.", plan, limit))
	case errors.Is(err, ErrActiveItemLimit):
		plan, code, limit := limitContext(account, func(l entitlements.Limits) int { return l.ActiveItemsPerList }, defaultMaxTasksPerList)
		writeLimitError(w, code+"_active_item_limit_reached", fmt.Sprintf("Max active items per list is %d on %s.", limit, plan))
	case storageQuotaError(err) != nil:
		quota := storageQuotaError(err)
		writeJSON(w, http.StatusConflict, map[string]any{
			"code":  quota.Code,
			"error": quota.Error(),
			"usage": quota.Current,
			"limit": quota.Limit,
		})
	case errors.Is(err, ErrTaskUnavailable):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, ErrIdempotencyKey):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, ErrIdempotencyGone):
		writeError(w, http.StatusGone, err.Error())
	case errors.Is(err, ErrAgentTaskScope):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, ErrInvalidData):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		slog.Error("board API request failed", "error", err)
		writeInternalError(w, err, "request failed")
	}
	return true
}

func storageQuotaError(err error) *StorageQuotaError {
	var quota *StorageQuotaError
	if errors.As(err, &quota) {
		return quota
	}
	return nil
}

func plural(value int, singular string, multiple string) string {
	if value == 1 {
		return singular
	}
	return multiple
}

func limitContext(account []entitlements.Entitlement, value func(entitlements.Limits) int, fallback int) (string, string, int) {
	if len(account) == 0 {
		return "Pro", "pro", fallback
	}
	name := "Free"
	code := "free"
	if account[0].Plan == entitlements.PlanPro {
		name = "Pro"
		code = "pro"
	}
	limit := value(account[0].Limits)
	if limit == 0 {
		limit = fallback
	}
	return name, code, limit
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

func writeLimitError(w http.ResponseWriter, code string, message string) {
	writeJSON(w, http.StatusConflict, map[string]string{"code": code, "error": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

type reorderInput struct {
	IDs []string `json:"ids"`
}
