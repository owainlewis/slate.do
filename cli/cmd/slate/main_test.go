package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEnvFallback(t *testing.T) {
	t.Setenv("SLATE_BASE_URL", "")
	if got := env("SLATE_BASE_URL", "http://localhost:8080"); got != "http://localhost:8080" {
		t.Fatalf("env fallback = %q", got)
	}
}

func TestUsage(t *testing.T) {
	if err := run([]string{"slate"}); err == nil {
		t.Fatal("expected usage error")
	}
}

func TestTasksPullNeedsNoOwner(t *testing.T) {
	var requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedPath = r.URL.RequestURI()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tasks":[]}`))
	}))
	defer server.Close()

	err := tasksCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{"pull"})
	if err != nil {
		t.Fatal(err)
	}
	if requestedPath != "/api/v1/agent/tasks" {
		t.Fatalf("requested %q, want /api/v1/agent/tasks", requestedPath)
	}
}

func TestTasksCreateSendsTitleAndDescription(t *testing.T) {
	var body map[string]any
	var decodeErr error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decodeErr = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-1"}`))
	}))
	defer server.Close()

	err := tasksCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{
		"create", "--list", "list-1", "--title", "Review positioning", "--description", "Compare options", "--date", "2026-07-13",
	})
	if err != nil {
		t.Fatal(err)
	}
	if decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if body["title"] != "Review positioning" || body["description"] != "Compare options" || body["scheduledDate"] != "2026-07-13" || body["kind"] != "action" {
		t.Fatalf("body = %#v", body)
	}
	if _, exists := body["agent"]; exists {
		t.Fatalf("body contains ownership field: %#v", body)
	}
}

func TestTasksUpdateCanClearDate(t *testing.T) {
	var body map[string]any
	var decodeErr error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decodeErr = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"task-1"}`))
	}))
	defer server.Close()

	err := tasksCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{"update", "task-1", "--date", ""})
	if err != nil {
		t.Fatal(err)
	}
	if decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if value, exists := body["scheduledDate"]; !exists || value != "" {
		t.Fatalf("body = %#v, want empty scheduledDate", body)
	}
}

func TestTasksWorkingStatusUsesAtomicClaimEndpoint(t *testing.T) {
	var method string
	var requestedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method = r.Method
		requestedPath = r.URL.RequestURI()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"working"}`))
	}))
	defer server.Close()

	err := tasksCmd(client{baseURL: server.URL, token: "test", http: server.Client()}, []string{"status", "task-1", "working"})
	if err != nil {
		t.Fatal(err)
	}
	if method != http.MethodPost || requestedPath != "/api/v1/agent/tasks/task-1/claim" {
		t.Fatalf("requested %s %q, want POST /api/v1/agent/tasks/task-1/claim", method, requestedPath)
	}
}
