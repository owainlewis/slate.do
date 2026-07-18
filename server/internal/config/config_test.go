package config

import "testing"

func TestFromEnvDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("COOKIE_SECURE", "")
	t.Setenv("DATABASE_URL", "")

	cfg := FromEnv()
	if cfg.Port != "8080" {
		t.Fatalf("Port = %q, want 8080", cfg.Port)
	}
	if !cfg.CookieSecure {
		t.Fatal("CookieSecure should default to true")
	}
	if cfg.DatabaseURL != "" {
		t.Fatalf("DatabaseURL = %q, want empty when unset", cfg.DatabaseURL)
	}
}

func TestFromEnvCookieSecure(t *testing.T) {
	t.Setenv("COOKIE_SECURE", "false")

	cfg := FromEnv()
	if cfg.CookieSecure {
		t.Fatal("CookieSecure should parse false")
	}
}

func TestFromEnvAdminCredentials(t *testing.T) {
	t.Setenv("ADMIN_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_PASSWORD", "admin-password")
	t.Setenv("OWNER_EMAIL", "legacy@example.com")
	t.Setenv("OWNER_PASSWORD", "legacy-password")

	cfg := FromEnv()
	if cfg.AdminEmail != "admin@example.com" || cfg.AdminPassword != "admin-password" {
		t.Fatalf("admin credentials = %q, %q", cfg.AdminEmail, cfg.AdminPassword)
	}
}

func TestFromEnvSupportsLegacyOwnerCredentials(t *testing.T) {
	t.Setenv("ADMIN_EMAIL", "")
	t.Setenv("ADMIN_PASSWORD", "")
	t.Setenv("OWNER_EMAIL", "legacy@example.com")
	t.Setenv("OWNER_PASSWORD", "legacy-password")

	cfg := FromEnv()
	if cfg.AdminEmail != "legacy@example.com" || cfg.AdminPassword != "legacy-password" {
		t.Fatalf("admin credentials = %q, %q", cfg.AdminEmail, cfg.AdminPassword)
	}
}

func TestFromEnvDoesNotMixAdminEmailWithLegacyPassword(t *testing.T) {
	t.Setenv("ADMIN_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_PASSWORD", "")
	t.Setenv("OWNER_EMAIL", "legacy@example.com")
	t.Setenv("OWNER_PASSWORD", "legacy-password")

	cfg := FromEnv()
	if cfg.AdminEmail != "admin@example.com" || cfg.AdminPassword != "" {
		t.Fatalf("admin credentials = %q, %q", cfg.AdminEmail, cfg.AdminPassword)
	}
}

func TestFromEnvDoesNotMixAdminPasswordWithLegacyEmail(t *testing.T) {
	t.Setenv("ADMIN_EMAIL", "")
	t.Setenv("ADMIN_PASSWORD", "admin-password")
	t.Setenv("OWNER_EMAIL", "legacy@example.com")
	t.Setenv("OWNER_PASSWORD", "legacy-password")

	cfg := FromEnv()
	if cfg.AdminEmail != "" || cfg.AdminPassword != "admin-password" {
		t.Fatalf("admin credentials = %q, %q", cfg.AdminEmail, cfg.AdminPassword)
	}
}
