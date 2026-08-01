package server

import (
	"context"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/database"
)

func TestHealthReportsTheEffectiveDatabasePoolSize(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run capacity integration tests")
	}
	db, err := database.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)

	static := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("app")}}
	app := NewApp(fs.FS(static), db, false, auth.Options{})
	recorder := httptest.NewRecorder()
	app.Routes().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"database":"ok"`) || !strings.Contains(recorder.Body.String(), `"databaseMaxConnections":4`) {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	db.Close()
	unavailable := httptest.NewRecorder()
	app.Routes().ServeHTTP(unavailable, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if unavailable.Code != http.StatusServiceUnavailable || !strings.Contains(unavailable.Body.String(), `"code":"service_unavailable"`) {
		t.Fatalf("closed database status = %d, body = %s", unavailable.Code, unavailable.Body.String())
	}
}
