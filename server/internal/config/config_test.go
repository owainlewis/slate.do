package config

import "testing"

func TestFromEnvDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("COOKIE_SECURE", "")

	cfg := FromEnv()
	if cfg.Port != "8080" {
		t.Fatalf("Port = %q, want 8080", cfg.Port)
	}
	if !cfg.CookieSecure {
		t.Fatal("CookieSecure should default to true")
	}
}

func TestFromEnvCookieSecure(t *testing.T) {
	t.Setenv("COOKIE_SECURE", "false")

	cfg := FromEnv()
	if cfg.CookieSecure {
		t.Fatal("CookieSecure should parse false")
	}
}
