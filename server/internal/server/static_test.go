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
