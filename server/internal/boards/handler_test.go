package boards

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/owainlewis/slate.do/server/internal/entitlements"
	"github.com/owainlewis/slate.do/server/internal/httpapi"
)

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
