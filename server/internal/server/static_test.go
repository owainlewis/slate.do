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

	shell := []string{"/", "/login", "/app", "/app/settings", "/app/boards/board_123", "/early-access", "/reset-password"}
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

	missing := []string{"/nonsense", "/app/boards", "/app/boards/board_123/extra", "/appleseed", "/app/missing.js"}
	for _, target := range missing {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("GET %s status = %d, want %d", target, response.Code, http.StatusNotFound)
		}
	}
}
