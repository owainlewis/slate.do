package server

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/owainlewis/slate.do/server/internal/auth"
)

func TestEarlyAccessPageFollowsInviteConfiguration(t *testing.T) {
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("signup shell")}}

	disabled := (&App{static: static}).Routes()
	disabledRecorder := httptest.NewRecorder()
	disabled.ServeHTTP(disabledRecorder, httptest.NewRequest(http.MethodGet, "/early-access", nil))
	if disabledRecorder.Code != http.StatusNotFound {
		t.Fatalf("disabled status = %d, want 404", disabledRecorder.Code)
	}

	enabled := (&App{static: fs.FS(static), auth: auth.NewService(nil, false, "configured")}).Routes()
	enabledRecorder := httptest.NewRecorder()
	enabled.ServeHTTP(enabledRecorder, httptest.NewRequest(http.MethodGet, "/early-access", nil))
	if enabledRecorder.Code != http.StatusOK || enabledRecorder.Body.String() != "signup shell" {
		t.Fatalf("enabled response = %d %q", enabledRecorder.Code, enabledRecorder.Body.String())
	}
}
