package config

import (
	"os"
	"strings"
)

type Config struct {
	Port          string
	DatabaseURL   string
	SessionSecret string
	CookieSecure  bool
	StaticDir     string
	AdminEmail    string
	AdminPassword string
	InviteCode    string
	AppBaseURL    string
	ResendAPIKey  string
	ResendFrom    string
}

func FromEnv() Config {
	adminEmail, adminPassword := adminCredentials()
	return Config{
		Port:          env("PORT", "8080"),
		DatabaseURL:   strings.TrimSpace(os.Getenv("DATABASE_URL")),
		SessionSecret: os.Getenv("SESSION_SECRET"),
		CookieSecure:  boolEnv("COOKIE_SECURE", true),
		StaticDir:     os.Getenv("STATIC_DIR"),
		AdminEmail:    adminEmail,
		AdminPassword: adminPassword,
		InviteCode:    os.Getenv("INVITE_CODE"),
		AppBaseURL:    env("APP_BASE_URL", "https://slate.do"),
		ResendAPIKey:  strings.TrimSpace(os.Getenv("RESEND_API_KEY")),
		ResendFrom:    strings.TrimSpace(os.Getenv("RESEND_FROM")),
	}
}

func adminCredentials() (string, string) {
	email := os.Getenv("ADMIN_EMAIL")
	password := os.Getenv("ADMIN_PASSWORD")
	if email != "" || password != "" {
		return email, password
	}
	return os.Getenv("OWNER_EMAIL"), os.Getenv("OWNER_PASSWORD")
}

func env(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func boolEnv(key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
