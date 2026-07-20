package boards

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
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
