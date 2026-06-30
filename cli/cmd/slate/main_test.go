package main

import "testing"

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
