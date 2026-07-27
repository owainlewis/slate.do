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
	for _, target := range []string{"/early-access", "/early-access/"} {
		disabledRecorder := httptest.NewRecorder()
		disabled.ServeHTTP(disabledRecorder, httptest.NewRequest(http.MethodGet, target, nil))
		if disabledRecorder.Code != http.StatusNotFound {
			t.Errorf("disabled GET %s status = %d, want 404", target, disabledRecorder.Code)
		}
	}

	enabled := (&App{static: fs.FS(static), auth: auth.NewService(nil, false, "configured")}).Routes()
	for _, target := range []string{"/early-access", "/early-access/"} {
		enabledRecorder := httptest.NewRecorder()
		enabled.ServeHTTP(enabledRecorder, httptest.NewRequest(http.MethodGet, target, nil))
		if enabledRecorder.Code != http.StatusOK || enabledRecorder.Body.String() != "signup shell" {
			t.Errorf("enabled GET %s response = %d %q", target, enabledRecorder.Code, enabledRecorder.Body.String())
		}
	}
}

func TestEarlyAccessNestedPathIsNotFound(t *testing.T) {
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("signup shell")}}
	handler := (&App{static: fs.FS(static), auth: auth.NewService(nil, false, "configured")}).Routes()
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/early-access/extra", nil))

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
}

func TestResetPasswordPageServesApplicationShell(t *testing.T) {
	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("reset shell")}}
	handler := (&App{static: fs.FS(static)}).Routes()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/reset-password", nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != "reset shell" {
		t.Fatalf("response = %d %q", recorder.Code, recorder.Body.String())
	}
}
