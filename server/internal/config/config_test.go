package config

import "testing"

func TestFromEnvDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("COOKIE_SECURE", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("INVITE_CODE", "")
	t.Setenv("APP_BASE_URL", "")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("RESEND_FROM", "")

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
	if cfg.InviteCode != "" {
		t.Fatalf("InviteCode = %q, want empty when unset", cfg.InviteCode)
	}
	if cfg.AppBaseURL != "https://slate.do" {
		t.Fatalf("AppBaseURL = %q, want production URL", cfg.AppBaseURL)
	}
	if cfg.ResendAPIKey != "" || cfg.ResendFrom != "" {
		t.Fatalf("Resend config should be empty by default")
	}
}

func TestFromEnvPasswordResetConfiguration(t *testing.T) {
	t.Setenv("APP_BASE_URL", " https://example.com ")
	t.Setenv("RESEND_API_KEY", " re_secret ")
	t.Setenv("RESEND_FROM", " Slate <passwords@example.com> ")

	cfg := FromEnv()
	if cfg.AppBaseURL != "https://example.com" || cfg.ResendAPIKey != "re_secret" || cfg.ResendFrom != "Slate <passwords@example.com>" {
		t.Fatalf("password reset config = %#v", cfg)
	}
}

func TestFromEnvInviteCodeIsExact(t *testing.T) {
	t.Setenv("INVITE_CODE", " shared code ")

	cfg := FromEnv()
	if cfg.InviteCode != " shared code " {
		t.Fatalf("InviteCode = %q, want exact secret value", cfg.InviteCode)
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
