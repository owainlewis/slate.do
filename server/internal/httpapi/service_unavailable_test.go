package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestWriteServiceUnavailableHandlesCapacityTimeouts(t *testing.T) {
	for _, err := range []error{
		context.DeadlineExceeded,
		&pgconn.PgError{Code: "57014", Message: "canceling statement due to statement timeout"},
		&pgconn.PgError{Code: "25P03", Message: "terminating connection due to idle-in-transaction timeout"},
	} {
		recorder := httptest.NewRecorder()
		if !WriteServiceUnavailable(recorder, err) {
			t.Fatalf("error %v was not handled", err)
		}
		if recorder.Code != http.StatusServiceUnavailable || !strings.Contains(recorder.Body.String(), `"code":"service_unavailable"`) {
			t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
		}
	}
}

func TestWriteServiceUnavailableLeavesOrdinaryErrorsAlone(t *testing.T) {
	recorder := httptest.NewRecorder()
	if WriteServiceUnavailable(recorder, errors.New("validation failed")) {
		t.Fatal("ordinary error was handled as a capacity error")
	}
	if recorder.Code != http.StatusOK || recorder.Body.Len() != 0 {
		t.Fatalf("response was changed: %d %q", recorder.Code, recorder.Body.String())
	}
}
