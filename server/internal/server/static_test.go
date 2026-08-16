package server

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestStaticHandlerServesExtensionlessHTMLPage(t *testing.T) {
	content := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("app")},
		"cli.html":   &fstest.MapFile{Data: []byte("cli guide")},
	}
	request := httptest.NewRequest(http.MethodGet, "/cli", nil)
	response := httptest.NewRecorder()

	StaticHandler(fs.FS(content)).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if body := response.Body.String(); body != "cli guide" {
		t.Fatalf("body = %q, want %q", body, "cli guide")
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "text/html; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want text/html; charset=utf-8", contentType)
	}
}

func TestStaticHandlerServesAppShellForFrontendRoutesOnly(t *testing.T) {
	content := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("app")},
		"cli.html":   &fstest.MapFile{Data: []byte("cli guide")},
		"app.js":     &fstest.MapFile{Data: []byte("script")},
	}
	handler := StaticHandler(fs.FS(content))

	shell := []string{
		"/", "/login", "/app", "/app/tasks", "/app/inbox", "/app/runs", "/app/runners", "/app/today", "/app/week", "/app/review", "/app/lists/list_123", "/app/settings",
		"/app/settings/profile", "/app/settings/board", "/app/settings/agents", "/app/settings/api",
		"/app/settings/unknown", "/app/settings/unknown/nested",
		"/app/boards/board_123", "/app/boards/board_123/settings", "/app/agents", "/app/agents/new", "/app/agents/agent_123",
		"/app/agents/agent_123/work", "/app/agents/agent_123/settings", "/early-access", "/reset-password",
	}
	for _, target := range shell {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
		if response.Code != http.StatusOK {
			t.Errorf("GET %s status = %d, want %d", target, response.Code, http.StatusOK)
		}
		if body := response.Body.String(); body != "app" {
			t.Errorf("GET %s body = %q, want %q", target, body, "app")
		}
	}

	missing := []string{"/nonsense", "/app/boards", "/app/agents/agent_123/extra", "/app/agents/agent_123/work/extra", "/app/agents/new/extra", "/app/boards/board_123/extra", "/app/boards/board_123/settings/extra", "/appleseed", "/app/missing.js"}
	for _, target := range missing {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("GET %s status = %d, want %d", target, response.Code, http.StatusNotFound)
		}
	}
}
