package server

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/migrations"
)

func TestCredentialLimitRejectsBeforeAuthenticationMutation(t *testing.T) {
	db := openServerIntegrationDB(t)
	ctx := context.Background()
	store := auth.NewPGStore(db)
	owner, err := store.CreateAdmin(ctx, fmt.Sprintf("preauth-%d@slate.test", time.Now().UnixNano()), "hash")
	if err != nil {
		t.Fatal(err)
	}
	token := fmt.Sprintf("slate_preauth_%d", time.Now().UnixNano())
	created, err := store.CreateAPIToken(ctx, owner.ID, "preauth", testTokenHash(token))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `
		UPDATE api_rate_limit_settings
		SET authenticated_read_limit = 1, authenticated_write_limit = 1
		WHERE singleton = true
	`); err != nil {
		t.Fatal(err)
	}

	handler := NewApp(fstest.MapFS{"index.html": {Data: []byte("app")}}, db, false, auth.Options{}).Routes()
	first := agentRequest(t, handler, token, http.MethodGet, "/api/v1/me", "")
	if first.Code != http.StatusOK {
		t.Fatalf("first valid request = %d %s", first.Code, first.Body.String())
	}
	var firstUsedAt time.Time
	if err := db.QueryRow(ctx, "SELECT last_used_at FROM api_tokens WHERE id = $1", created.ID).Scan(&firstUsedAt); err != nil {
		t.Fatal(err)
	}
	second := agentRequest(t, handler, token, http.MethodGet, "/api/v1/me", "")
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second valid request = %d %s", second.Code, second.Body.String())
	}
	var secondUsedAt time.Time
	if err := db.QueryRow(ctx, "SELECT last_used_at FROM api_tokens WHERE id = $1", created.ID).Scan(&secondUsedAt); err != nil {
		t.Fatal(err)
	}
	if !secondUsedAt.Equal(firstUsedAt) {
		t.Fatalf("rate-limited token last_used_at changed from %s to %s", firstUsedAt, secondUsedAt)
	}

	invalid := fmt.Sprintf("slate_invalid_%d", time.Now().UnixNano())
	invalidFirst := agentRequest(t, handler, invalid, http.MethodGet, "/api/v1/me", "")
	invalidSecond := agentRequest(t, handler, invalid, http.MethodGet, "/api/v1/me", "")
	if invalidFirst.Code != http.StatusOK || invalidSecond.Code != http.StatusTooManyRequests {
		t.Fatalf("invalid credential responses = %d %s then %d %s", invalidFirst.Code, invalidFirst.Body.String(), invalidSecond.Code, invalidSecond.Body.String())
	}
	if invalidSecond.Body.String() != second.Body.String() {
		t.Fatalf("exhausted valid and invalid credentials differed: valid=%s invalid=%s", second.Body.String(), invalidSecond.Body.String())
	}

	var allowedBefore, rejectedBefore, publicAllowedBefore, publicRejectedBefore int
	if err := db.QueryRow(ctx, `
		SELECT COALESCE(sum(request_count) FILTER (WHERE outcome = 'allowed'), 0),
			COALESCE(sum(request_count) FILTER (WHERE outcome = 'rejected'), 0)
		FROM api_rate_limit_metrics WHERE route_class = 'authenticated_read'
	`).Scan(&allowedBefore, &rejectedBefore); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `
		SELECT COALESCE(sum(request_count) FILTER (WHERE outcome = 'allowed'), 0),
			COALESCE(sum(request_count) FILTER (WHERE outcome = 'rejected'), 0)
		FROM api_rate_limit_metrics WHERE route_class = 'public_auth'
	`).Scan(&publicAllowedBefore, &publicRejectedBefore); err != nil {
		t.Fatal(err)
	}
	mixedToken := fmt.Sprintf("slate_mixed_invalid_%d", time.Now().UnixNano())
	mixedFirst := requestWithCredentials(handler, "stale-session", mixedToken)
	mixedSecond := requestWithCredentials(handler, "stale-session", mixedToken)
	if mixedFirst.Code != http.StatusOK || mixedSecond.Code != http.StatusTooManyRequests {
		t.Fatalf("mixed invalid responses = %d %s then %d %s", mixedFirst.Code, mixedFirst.Body.String(), mixedSecond.Code, mixedSecond.Body.String())
	}
	var allowedAfter, rejectedAfter, publicAllowedAfter, publicRejectedAfter int
	if err := db.QueryRow(ctx, `
		SELECT COALESCE(sum(request_count) FILTER (WHERE outcome = 'allowed'), 0),
			COALESCE(sum(request_count) FILTER (WHERE outcome = 'rejected'), 0)
		FROM api_rate_limit_metrics WHERE route_class = 'authenticated_read'
	`).Scan(&allowedAfter, &rejectedAfter); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `
		SELECT COALESCE(sum(request_count) FILTER (WHERE outcome = 'allowed'), 0),
			COALESCE(sum(request_count) FILTER (WHERE outcome = 'rejected'), 0)
		FROM api_rate_limit_metrics WHERE route_class = 'public_auth'
	`).Scan(&publicAllowedAfter, &publicRejectedAfter); err != nil {
		t.Fatal(err)
	}
	if allowedAfter-allowedBefore != 0 || rejectedAfter-rejectedBefore != 1 ||
		publicAllowedAfter-publicAllowedBefore != 1 || publicRejectedAfter-publicRejectedBefore != 0 {
		t.Fatalf("mixed credential metric deltas authenticated=%d/%d public=%d/%d",
			allowedAfter-allowedBefore, rejectedAfter-rejectedBefore,
			publicAllowedAfter-publicAllowedBefore, publicRejectedAfter-publicRejectedBefore)
	}
}

func requestWithCredentials(handler http.Handler, session string, bearer string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	request.AddCookie(&http.Cookie{Name: auth.CookieName, Value: session})
	request.Header.Set("Authorization", "Bearer "+bearer)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func openServerIntegrationDB(t *testing.T) *database.Pool {
	t.Helper()
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run server integration tests")
	}
	ctx := context.Background()
	admin, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("server_preauth_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil || (parsedURL.Scheme != "postgres" && parsedURL.Scheme != "postgresql") {
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
		t.Fatalf("SLATE_TEST_DATABASE_URL must be a PostgreSQL URL: %v", err)
	}
	query := parsedURL.Query()
	query.Set("search_path", schema+",public")
	parsedURL.RawQuery = query.Encode()
	db, err := database.Open(ctx, parsedURL.String())
	if err != nil {
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	if _, err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}
	return db
}
