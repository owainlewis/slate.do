package config

import (
	"strings"
	"testing"
	"time"
)

func TestFromEnvDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("COOKIE_SECURE", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("INVITE_CODE", "")
	t.Setenv("APP_BASE_URL", "")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("RESEND_FROM", "")

	cfg := mustConfig(t)
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
	if cfg.AppMaxInstances != 4 || cfg.DBMaxConnections != 2 || cfg.DBConnectionAllowance != 25 || cfg.DBReservedConnections != 9 {
		t.Fatalf("capacity defaults = %#v", cfg)
	}
	if cfg.DBAcquireTimeout != 2*time.Second || cfg.DBStatementTimeout != 10*time.Second || cfg.DBIdleTransactionTimeout != 10*time.Second || cfg.DBMaxConnectionIdleTime != 5*time.Minute || cfg.RequestTimeout != 15*time.Second {
		t.Fatalf("timeout defaults = %#v", cfg)
	}
}

func TestFromEnvPasswordResetConfiguration(t *testing.T) {
	t.Setenv("APP_BASE_URL", " https://example.com ")
	t.Setenv("RESEND_API_KEY", " re_secret ")
	t.Setenv("RESEND_FROM", " Slate <passwords@example.com> ")

	cfg := mustConfig(t)
	if cfg.AppBaseURL != "https://example.com" || cfg.ResendAPIKey != "re_secret" || cfg.ResendFrom != "Slate <passwords@example.com>" {
		t.Fatalf("password reset config = %#v", cfg)
	}
}

func TestFromEnvInviteCodeIsExact(t *testing.T) {
	t.Setenv("INVITE_CODE", " shared code ")

	cfg := mustConfig(t)
	if cfg.InviteCode != " shared code " {
		t.Fatalf("InviteCode = %q, want exact secret value", cfg.InviteCode)
	}
}

func TestFromEnvCookieSecure(t *testing.T) {
	t.Setenv("COOKIE_SECURE", "false")

	cfg := mustConfig(t)
	if cfg.CookieSecure {
		t.Fatal("CookieSecure should parse false")
	}
}

func TestFromEnvAdminCredentials(t *testing.T) {
	t.Setenv("ADMIN_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_PASSWORD", "admin-password")
	t.Setenv("OWNER_EMAIL", "legacy@example.com")
	t.Setenv("OWNER_PASSWORD", "legacy-password")

	cfg := mustConfig(t)
	if cfg.AdminEmail != "admin@example.com" || cfg.AdminPassword != "admin-password" {
		t.Fatalf("admin credentials = %q, %q", cfg.AdminEmail, cfg.AdminPassword)
	}
}

func TestFromEnvSupportsLegacyOwnerCredentials(t *testing.T) {
	t.Setenv("ADMIN_EMAIL", "")
	t.Setenv("ADMIN_PASSWORD", "")
	t.Setenv("OWNER_EMAIL", "legacy@example.com")
	t.Setenv("OWNER_PASSWORD", "legacy-password")

	cfg := mustConfig(t)
	if cfg.AdminEmail != "legacy@example.com" || cfg.AdminPassword != "legacy-password" {
		t.Fatalf("admin credentials = %q, %q", cfg.AdminEmail, cfg.AdminPassword)
	}
}

func TestFromEnvDoesNotMixAdminEmailWithLegacyPassword(t *testing.T) {
	t.Setenv("ADMIN_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_PASSWORD", "")
	t.Setenv("OWNER_EMAIL", "legacy@example.com")
	t.Setenv("OWNER_PASSWORD", "legacy-password")

	cfg := mustConfig(t)
	if cfg.AdminEmail != "admin@example.com" || cfg.AdminPassword != "" {
		t.Fatalf("admin credentials = %q, %q", cfg.AdminEmail, cfg.AdminPassword)
	}
}

func TestFromEnvDoesNotMixAdminPasswordWithLegacyEmail(t *testing.T) {
	t.Setenv("ADMIN_EMAIL", "")
	t.Setenv("ADMIN_PASSWORD", "admin-password")
	t.Setenv("OWNER_EMAIL", "legacy@example.com")
	t.Setenv("OWNER_PASSWORD", "legacy-password")

	cfg := mustConfig(t)
	if cfg.AdminEmail != "" || cfg.AdminPassword != "admin-password" {
		t.Fatalf("admin credentials = %q, %q", cfg.AdminEmail, cfg.AdminPassword)
	}
}

func TestFromEnvAcceptsASafeConfigurableCapacityEnvelope(t *testing.T) {
	t.Setenv("APP_MAX_INSTANCES", "6")
	t.Setenv("DB_MAX_CONNECTIONS", "5")
	t.Setenv("DB_CONNECTION_ALLOWANCE", "40")
	t.Setenv("DB_RESERVED_CONNECTIONS", "10")
	t.Setenv("DB_ACQUIRE_TIMEOUT", "3s")
	t.Setenv("DB_STATEMENT_TIMEOUT", "12s")
	t.Setenv("DB_IDLE_TRANSACTION_TIMEOUT", "20s")
	t.Setenv("DB_MAX_CONNECTION_IDLE_TIME", "4m")
	t.Setenv("DB_MAX_CONNECTION_LIFETIME", "25m")
	t.Setenv("REQUEST_TIMEOUT", "20s")
	t.Setenv("HTTP_IDLE_TIMEOUT", "45s")

	cfg := mustConfig(t)
	if cfg.AppMaxInstances != 6 || cfg.DBMaxConnections != 5 || cfg.DBAcquireTimeout != 3*time.Second || cfg.RequestTimeout != 20*time.Second {
		t.Fatalf("config = %#v", cfg)
	}
}

func TestFromEnvRejectsUnsafeOrInvalidCapacityValues(t *testing.T) {
	for _, test := range []struct {
		name    string
		key     string
		value   string
		message string
	}{
		{name: "invalid integer", key: "DB_MAX_CONNECTIONS", value: "many", message: "invalid DB_MAX_CONNECTIONS"},
		{name: "invalid duration", key: "REQUEST_TIMEOUT", value: "soon", message: "invalid REQUEST_TIMEOUT"},
		{name: "zero pool", key: "DB_MAX_CONNECTIONS", value: "0", message: "invalid DB_MAX_CONNECTIONS"},
		{name: "reserve consumes allowance", key: "DB_RESERVED_CONNECTIONS", value: "25", message: "invalid DB_RESERVED_CONNECTIONS"},
		{name: "unsafe product", key: "APP_MAX_INSTANCES", value: "9", message: "unsafe database capacity"},
		{name: "acquire exceeds request", key: "DB_ACQUIRE_TIMEOUT", value: "15s", message: "invalid DB_ACQUIRE_TIMEOUT"},
		{name: "statement exceeds request", key: "DB_STATEMENT_TIMEOUT", value: "15s", message: "invalid DB_STATEMENT_TIMEOUT"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv(test.key, test.value)
			_, err := FromEnv()
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("error = %v, want %q", err, test.message)
			}
		})
	}
}

func mustConfig(t *testing.T) Config {
	t.Helper()
	cfg, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}
