package boards

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/entitlements"
	"github.com/owainlewis/slate.do/server/internal/httpapi"
)

func TestListTasksRejectsMalformedLocationIDsBeforeStore(t *testing.T) {
	handler := NewHandler(nil)
	for _, query := range []string{"boardId=not-a-uuid", "bucketId=not-a-uuid"} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/v1/tasks?"+query, nil)

		handler.ListTasks(recorder, request, auth.User{})

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("query %q status = %d, body = %s", query, recorder.Code, recorder.Body.String())
		}
		if !strings.Contains(recorder.Body.String(), "must be a valid ID") {
			t.Fatalf("query %q body = %s", query, recorder.Body.String())
		}
	}
}

func TestChildAndConversationRoutesRejectMalformedCardIDsBeforeStore(t *testing.T) {
	handler := NewHandler(nil)
	tests := []struct {
		name string
		call func(http.ResponseWriter, *http.Request, auth.User)
	}{
		{name: "create child", call: handler.CreateSubtask},
		{name: "list conversation", call: handler.ListCardEntries},
		{name: "create conversation entry", call: handler.CreateCardEntry},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/", nil)
			request.SetPathValue("id", "not-a-uuid")

			test.call(recorder, request, auth.User{})

			if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "must be a valid ID") {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestGenericTaskCreateRejectsMalformedParentIDBeforeDatabaseAccess(t *testing.T) {
	handler := NewHandler(NewStore(nil))
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/tasks", strings.NewReader(`{"title":"Child","parentTaskId":"not-a-uuid"}`))
	request.Header.Set("Content-Type", "application/json")

	handler.CreateInboxTask(recorder, request, auth.User{})

	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "parentTaskId must be a valid ID") {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestStoreRejectsMalformedChildAndConversationCardIDs(t *testing.T) {
	store := NewStore(nil)
	if _, err := store.CreateSubtask(context.Background(), "", "not-a-uuid", CreateTaskInput{}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("create child error = %v", err)
	}
	if _, err := store.ListCardEntries(context.Background(), "", "", "not-a-uuid"); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("list conversation error = %v", err)
	}
	if _, err := store.CreateCardEntry(context.Background(), "", "", "", "not-a-uuid", CreateCardEntryInput{}); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("create conversation entry error = %v", err)
	}
}

func TestStoreCapacityTimeoutUsesStableServiceUnavailableResponse(t *testing.T) {
	recorder := httptest.NewRecorder()
	if !handleStoreError(recorder, context.DeadlineExceeded) {
		t.Fatal("capacity timeout was not handled")
	}
	if recorder.Code != http.StatusServiceUnavailable || !strings.Contains(recorder.Body.String(), `"code":"service_unavailable"`) {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestConversationReadJSONOmitsMutationOnlyCardState(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeJSON(recorder, http.StatusOK, map[string]any{
		"entries": []CardEntry{{ID: "entry-one", TaskID: "card-one", Kind: "comment", Body: "Hello"}},
	})
	if strings.Contains(recorder.Body.String(), "cardStatus") || strings.Contains(recorder.Body.String(), "cardDone") || strings.Contains(recorder.Body.String(), "cardReviewReason") {
		t.Fatalf("conversation response leaked mutation-only card state: %s", recorder.Body.String())
	}
}

func TestTaskJSONPreservesDerivedLegacyDoneField(t *testing.T) {
	for _, test := range []struct {
		status string
		done   bool
	}{
		{status: StatusDone, done: true},
		{status: StatusQueued, done: false},
	} {
		recorder := httptest.NewRecorder()
		writeJSON(recorder, http.StatusOK, Task{ID: "card-one", Status: test.status})
		var response map[string]any
		if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
			t.Fatal(err)
		}
		if response["done"] != test.done || response["status"] != test.status {
			t.Fatalf("response = %#v", response)
		}
	}
}

func TestUpdateTaskInputAcceptsLegacyDoneField(t *testing.T) {
	var input UpdateTaskInput
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/tasks/card-one", strings.NewReader(`{"done":true}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	if !decodeJSON(recorder, request, &input) {
		t.Fatalf("legacy update was rejected: %s", recorder.Body.String())
	}
	if input.Done == nil || !*input.Done {
		t.Fatalf("input = %#v", input)
	}
}

func TestProLimitErrorsUseStableCodesAndActiveItemLanguage(t *testing.T) {
	tests := []struct {
		err     error
		code    string
		message string
	}{
		{ErrBoardLimit, "pro_board_limit_reached", "Pro allows up to 5 boards."},
		{ErrListLimit, "pro_list_limit_reached", "Pro allows up to 9 lists per board."},
		{ErrActiveItemLimit, "pro_active_item_limit_reached", "Max active items per list is 20 on Pro."},
	}
	for _, test := range tests {
		t.Run(test.code, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			if !handleStoreError(recorder, test.err) {
				t.Fatal("limit error was not handled")
			}
			if recorder.Code != http.StatusConflict {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusConflict)
			}
			var response map[string]string
			if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
				t.Fatal(err)
			}
			if response["code"] != test.code || response["error"] != test.message {
				t.Fatalf("response = %#v", response)
			}
		})
	}
}

func TestFreeLimitErrorsUsePlanSpecificStableCodes(t *testing.T) {
	recorder := httptest.NewRecorder()
	if !handleStoreError(recorder, ErrBoardLimit, entitlements.Free()) {
		t.Fatal("limit error was not handled")
	}
	var response map[string]string
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response["code"] != "free_board_limit_reached" || response["error"] != "Free allows up to 1 board." {
		t.Fatalf("response = %#v", response)
	}
}

func TestStorageQuotaErrorsIncludeStableCodeUsageAndLimit(t *testing.T) {
	recorder := httptest.NewRecorder()
	quota := &StorageQuotaError{Code: StoredContentLimitCode, Current: 10485760, Limit: 10485760}
	if !handleStoreError(recorder, quota) {
		t.Fatal("quota error was not handled")
	}
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusConflict)
	}
	var response struct {
		Code  string `json:"code"`
		Usage int64  `json:"usage"`
		Limit int64  `json:"limit"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.Code != StoredContentLimitCode || response.Usage != quota.Current || response.Limit != quota.Limit {
		t.Fatalf("response = %#v", response)
	}
}

func TestBoardUpdateRejectionsUseValidationAndNotFoundResponses(t *testing.T) {
	tests := []struct {
		name    string
		err     error
		status  int
		message string
	}{
		{"blank name", ErrInvalidData, http.StatusBadRequest, "invalid data"},
		{"missing or unauthorized board", ErrNotFound, http.StatusNotFound, "not found"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			if !handleStoreError(recorder, test.err) {
				t.Fatal("store error was not handled")
			}
			if recorder.Code != test.status {
				t.Fatalf("status = %d, want %d", recorder.Code, test.status)
			}
			var response map[string]string
			if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
				t.Fatal(err)
			}
			if response["error"] != test.message {
				t.Fatalf("error = %q, want %q", response["error"], test.message)
			}
		})
	}
}

func TestStoredTextLimitsAcceptExactBoundariesAndRejectOneOver(t *testing.T) {
	tests := []struct {
		name  string
		field string
		exact func(http.ResponseWriter) bool
		over  func(http.ResponseWriter) bool
	}{
		{
			name: "board name", field: "name",
			exact: func(w http.ResponseWriter) bool {
				return validateCreateBoardText(w, CreateBoardInput{Name: strings.Repeat("🙂", httpapi.BoardNameRunes)})
			},
			over: func(w http.ResponseWriter) bool {
				return validateCreateBoardText(w, CreateBoardInput{Name: strings.Repeat("🙂", httpapi.BoardNameRunes+1)})
			},
		},
		{
			name: "board background kind", field: "backgroundKind",
			exact: func(w http.ResponseWriter) bool {
				return validateCreateBoardText(w, CreateBoardInput{Name: "Board", BackgroundKind: strings.Repeat("a", httpapi.BoardBackgroundKind)})
			},
			over: func(w http.ResponseWriter) bool {
				return validateCreateBoardText(w, CreateBoardInput{Name: "Board", BackgroundKind: strings.Repeat("a", httpapi.BoardBackgroundKind+1)})
			},
		},
		{
			name: "board background value", field: "backgroundValue",
			exact: func(w http.ResponseWriter) bool {
				return validateCreateBoardText(w, CreateBoardInput{Name: "Board", BackgroundValue: strings.Repeat("🙂", httpapi.BoardBackgroundRunes)})
			},
			over: func(w http.ResponseWriter) bool {
				return validateCreateBoardText(w, CreateBoardInput{Name: "Board", BackgroundValue: strings.Repeat("🙂", httpapi.BoardBackgroundRunes+1)})
			},
		},
		{
			name: "list name", field: "name",
			exact: func(w http.ResponseWriter) bool {
				return validateCreateBucketText(w, CreateBucketInput{Name: strings.Repeat("🙂", httpapi.ListNameRunes)})
			},
			over: func(w http.ResponseWriter) bool {
				return validateCreateBucketText(w, CreateBucketInput{Name: strings.Repeat("🙂", httpapi.ListNameRunes+1)})
			},
		},
		{
			name: "list goal bytes", field: "goal",
			exact: func(w http.ResponseWriter) bool {
				return validateCreateBucketText(w, CreateBucketInput{Name: "List", Goal: strings.Repeat("é", httpapi.ListGoalBytes/2)})
			},
			over: func(w http.ResponseWriter) bool {
				return validateCreateBucketText(w, CreateBucketInput{Name: "List", Goal: strings.Repeat("é", httpapi.ListGoalBytes/2+1)})
			},
		},
		{
			name: "task title", field: "title",
			exact: func(w http.ResponseWriter) bool {
				return validateCreateTaskText(w, CreateTaskInput{Title: strings.Repeat("🙂", httpapi.TaskTitleRunes)})
			},
			over: func(w http.ResponseWriter) bool {
				return validateCreateTaskText(w, CreateTaskInput{Title: strings.Repeat("🙂", httpapi.TaskTitleRunes+1)})
			},
		},
		{
			name: "task description bytes", field: "description",
			exact: func(w http.ResponseWriter) bool {
				return validateCreateTaskText(w, CreateTaskInput{Title: "Task", Description: strings.Repeat("é", httpapi.TaskDescriptionBytes/2)})
			},
			over: func(w http.ResponseWriter) bool {
				return validateCreateTaskText(w, CreateTaskInput{Title: "Task", Description: strings.Repeat("é", httpapi.TaskDescriptionBytes/2+1)})
			},
		},
		{
			name: "task idempotency key bytes", field: "Idempotency-Key",
			exact: func(w http.ResponseWriter) bool {
				return validateTaskIdempotencyKey(w, strings.Repeat("a", httpapi.TaskIdempotencyBytes-2)+"é")
			},
			over: func(w http.ResponseWriter) bool {
				return validateTaskIdempotencyKey(w, strings.Repeat("a", httpapi.TaskIdempotencyBytes-1)+"é")
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			exact := httptest.NewRecorder()
			if !test.exact(exact) {
				t.Fatalf("exact boundary rejected: %s", exact.Body.String())
			}
			over := httptest.NewRecorder()
			if test.over(over) {
				t.Fatal("one-over boundary accepted")
			}
			body := over.Body.String()
			if over.Code != http.StatusBadRequest || !strings.Contains(body, `"code":"field_too_long"`) || !strings.Contains(body, `"field":"`+test.field+`"`) {
				t.Fatalf("status = %d, body = %s", over.Code, body)
			}
		})
	}
}
