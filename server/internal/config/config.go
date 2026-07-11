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
	OwnerEmail    string
	OwnerPassword string
}

func FromEnv() Config {
	return Config{
		Port:          env("PORT", "8080"),
		DatabaseURL:   env("DATABASE_URL", "postgres://localhost/slate_dev?sslmode=disable"),
		SessionSecret: os.Getenv("SESSION_SECRET"),
		CookieSecure:  boolEnv("COOKIE_SECURE", true),
		StaticDir:     os.Getenv("STATIC_DIR"),
		OwnerEmail:    os.Getenv("OWNER_EMAIL"),
		OwnerPassword: os.Getenv("OWNER_PASSWORD"),
	}
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
