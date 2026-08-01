package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
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

	AppMaxInstances          int
	DBMaxConnections         int32
	DBConnectionAllowance    int
	DBReservedConnections    int
	DBAcquireTimeout         time.Duration
	DBStatementTimeout       time.Duration
	DBIdleTransactionTimeout time.Duration
	DBMaxConnectionIdleTime  time.Duration
	DBMaxConnectionLifetime  time.Duration
	RequestTimeout           time.Duration
	HTTPIdleTimeout          time.Duration
}

func FromEnv() (Config, error) {
	adminEmail, adminPassword := adminCredentials()
	appMaxInstances, err := intEnv("APP_MAX_INSTANCES", 4)
	if err != nil {
		return Config{}, err
	}
	dbMaxConnections, err := intEnv("DB_MAX_CONNECTIONS", 2)
	if err != nil {
		return Config{}, err
	}
	if int64(dbMaxConnections) > int64(^uint32(0)>>1) {
		return Config{}, errorsFor("DB_MAX_CONNECTIONS", "is too large")
	}
	dbConnectionAllowance, err := intEnv("DB_CONNECTION_ALLOWANCE", 25)
	if err != nil {
		return Config{}, err
	}
	dbReservedConnections, err := intEnv("DB_RESERVED_CONNECTIONS", 9)
	if err != nil {
		return Config{}, err
	}
	dbAcquireTimeout, err := durationEnv("DB_ACQUIRE_TIMEOUT", 2*time.Second)
	if err != nil {
		return Config{}, err
	}
	dbStatementTimeout, err := durationEnv("DB_STATEMENT_TIMEOUT", 10*time.Second)
	if err != nil {
		return Config{}, err
	}
	dbIdleTransactionTimeout, err := durationEnv("DB_IDLE_TRANSACTION_TIMEOUT", 10*time.Second)
	if err != nil {
		return Config{}, err
	}
	dbMaxConnectionIdleTime, err := durationEnv("DB_MAX_CONNECTION_IDLE_TIME", 5*time.Minute)
	if err != nil {
		return Config{}, err
	}
	dbMaxConnectionLifetime, err := durationEnv("DB_MAX_CONNECTION_LIFETIME", 30*time.Minute)
	if err != nil {
		return Config{}, err
	}
	requestTimeout, err := durationEnv("REQUEST_TIMEOUT", 15*time.Second)
	if err != nil {
		return Config{}, err
	}
	httpIdleTimeout, err := durationEnv("HTTP_IDLE_TIMEOUT", 60*time.Second)
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
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

		AppMaxInstances:          appMaxInstances,
		DBMaxConnections:         int32(dbMaxConnections),
		DBConnectionAllowance:    dbConnectionAllowance,
		DBReservedConnections:    dbReservedConnections,
		DBAcquireTimeout:         dbAcquireTimeout,
		DBStatementTimeout:       dbStatementTimeout,
		DBIdleTransactionTimeout: dbIdleTransactionTimeout,
		DBMaxConnectionIdleTime:  dbMaxConnectionIdleTime,
		DBMaxConnectionLifetime:  dbMaxConnectionLifetime,
		RequestTimeout:           requestTimeout,
		HTTPIdleTimeout:          httpIdleTimeout,
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) Validate() error {
	if c.AppMaxInstances < 1 {
		return errorsFor("APP_MAX_INSTANCES", "must be at least 1")
	}
	if c.DBMaxConnections < 1 {
		return errorsFor("DB_MAX_CONNECTIONS", "must be at least 1")
	}
	if c.DBConnectionAllowance < 2 {
		return errorsFor("DB_CONNECTION_ALLOWANCE", "must be at least 2")
	}
	if c.DBReservedConnections < 1 || c.DBReservedConnections >= c.DBConnectionAllowance {
		return errorsFor("DB_RESERVED_CONNECTIONS", "must be at least 1 and below DB_CONNECTION_ALLOWANCE")
	}
	available := int64(c.DBConnectionAllowance - c.DBReservedConnections)
	if int64(c.AppMaxInstances) > available/int64(c.DBMaxConnections) {
		return fmt.Errorf("unsafe database capacity: APP_MAX_INSTANCES x DB_MAX_CONNECTIONS exceeds the %d connections available after the reserve", available)
	}
	for name, value := range map[string]time.Duration{
		"DB_ACQUIRE_TIMEOUT":          c.DBAcquireTimeout,
		"DB_STATEMENT_TIMEOUT":        c.DBStatementTimeout,
		"DB_IDLE_TRANSACTION_TIMEOUT": c.DBIdleTransactionTimeout,
		"DB_MAX_CONNECTION_IDLE_TIME": c.DBMaxConnectionIdleTime,
		"DB_MAX_CONNECTION_LIFETIME":  c.DBMaxConnectionLifetime,
		"REQUEST_TIMEOUT":             c.RequestTimeout,
		"HTTP_IDLE_TIMEOUT":           c.HTTPIdleTimeout,
	} {
		if value < time.Millisecond {
			return errorsFor(name, "must be at least 1ms")
		}
	}
	if c.DBAcquireTimeout >= c.RequestTimeout {
		return errorsFor("DB_ACQUIRE_TIMEOUT", "must be shorter than REQUEST_TIMEOUT")
	}
	if c.DBStatementTimeout >= c.RequestTimeout {
		return errorsFor("DB_STATEMENT_TIMEOUT", "must be shorter than REQUEST_TIMEOUT")
	}
	return nil
}

func errorsFor(name string, message string) error {
	return fmt.Errorf("invalid %s: %s", name, message)
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

func intEnv(key string, fallback int) (int, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, errorsFor(key, "must be an integer")
	}
	return parsed, nil
}

func durationEnv(key string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, errorsFor(key, "must be a Go duration such as 2s or 5m")
	}
	return parsed, nil
}
