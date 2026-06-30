package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHashTokenIsStableAndDoesNotExposeToken(t *testing.T) {
	first := hashToken("slate_secret")
	second := hashToken("slate_secret")
	if first != second {
		t.Fatal("hashToken should be stable")
	}
	if first == "slate_secret" {
		t.Fatal("hashToken should not return the input")
	}
}

func TestReadBearerToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer slate_abc")

	token, ok := readBearerToken(req)
	if !ok || token != "slate_abc" {
		t.Fatalf("token = %q, %v", token, ok)
	}
}

func TestSameOriginRejectsDifferentHost(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "https://slate.test/api", nil)
	req.Host = "slate.test"
	req.Header.Set("Origin", "https://evil.test")
	rec := httptest.NewRecorder()

	if validateSameOrigin(rec, req) {
		t.Fatal("expected different origin to be blocked")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}
