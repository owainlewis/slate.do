package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResendSenderSendsExpectedRequestWithoutExposingAPIKey(t *testing.T) {
	var authorization string
	var userAgent string
	var idempotencyKey string
	var payload struct {
		From    string   `json:"from"`
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		HTML    string   `json:"html"`
		Text    string   `json:"text"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		userAgent = r.Header.Get("User-Agent")
		idempotencyKey = r.Header.Get("Idempotency-Key")
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"email-id"}`))
	}))
	defer server.Close()

	sender := NewResendSender("re_secret", "Slate <passwords@slate.do>", server.Client())
	sender.apiURL = server.URL
	if err := sender.SendPasswordReset(context.Background(), "person@example.com", "https://slate.do/reset-password#token=reset_value", "password-reset-request-1"); err != nil {
		t.Fatal(err)
	}
	if authorization != "Bearer re_secret" || userAgent != "slate.do/1.0" {
		t.Fatalf("headers = authorization %q, user agent %q", authorization, userAgent)
	}
	if idempotencyKey != "password-reset-request-1" {
		t.Fatalf("idempotency key = %q", idempotencyKey)
	}
	if payload.From != "Slate <passwords@slate.do>" || len(payload.To) != 1 || payload.To[0] != "person@example.com" || payload.Subject == "" {
		t.Fatalf("payload = %#v", payload)
	}
	if payload.HTML == "" || payload.Text == "" {
		t.Fatal("expected HTML and plain-text email bodies")
	}
}

func TestResendSenderRejectsNonSuccessResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "contains provider details", http.StatusForbidden)
	}))
	defer server.Close()
	sender := NewResendSender("re_secret", "Slate <passwords@slate.do>", server.Client())
	sender.apiURL = server.URL
	if err := sender.SendPasswordReset(context.Background(), "person@example.com", "https://slate.do/reset-password#token=reset_value", "password-reset-request-1"); err == nil || err.Error() != "send password reset: resend returned status 403" {
		t.Fatalf("error = %v", err)
	}
}
