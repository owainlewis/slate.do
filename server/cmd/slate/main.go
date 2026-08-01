package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/boards"
	"github.com/owainlewis/slate.do/server/internal/cleanup"
	"github.com/owainlewis/slate.do/server/internal/config"
	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/migrations"
	slatehttp "github.com/owainlewis/slate.do/server/internal/server"
	"github.com/owainlewis/slate.do/server/internal/web"
)

func main() {
	if err := run(os.Args); err != nil {
		slog.Error("command failed", "error", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) < 2 {
		return usage()
	}
	cfg, err := config.FromEnv()
	if err != nil {
		return err
	}
	switch args[1] {
	case "serve":
		return serve(cfg)
	case "migrate":
		return migrate(cfg)
	case "cleanup":
		return cleanupOperationalData(cfg)
	case "seed-admin", "seed-owner":
		return seedAdmin(cfg)
	case "accounts":
		return accounts(cfg, args[2:])
	default:
		return usage()
	}
}

func usage() error {
	return errors.New("usage: slate serve|migrate|cleanup|seed-admin|accounts list|accounts disable <email>|accounts enable <email>")
}

func serve(cfg config.Config) error {
	if cfg.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := database.Open(ctx, cfg.DatabaseURL, database.Options{
		MaxConnections:         cfg.DBMaxConnections,
		AcquireTimeout:         cfg.DBAcquireTimeout,
		StatementTimeout:       cfg.DBStatementTimeout,
		IdleTransactionTimeout: cfg.DBIdleTransactionTimeout,
		MaxConnectionIdleTime:  cfg.DBMaxConnectionIdleTime,
		MaxConnectionLifetime:  cfg.DBMaxConnectionLifetime,
		ConnectionLimit:        cfg.DBConnectionAllowance - cfg.DBReservedConnections,
	})
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer db.Close()
	if err := verifyDatabaseCapacity(ctx, db, cfg); err != nil {
		return err
	}
	if _, err := migrations.Apply(ctx, db); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}

	staticFS, err := web.FileSystem(cfg.StaticDir)
	if err != nil {
		return err
	}

	var passwordResetSender auth.PasswordResetSender
	if cfg.ResendAPIKey != "" && cfg.ResendFrom != "" {
		passwordResetSender = auth.NewResendSender(cfg.ResendAPIKey, cfg.ResendFrom, nil)
	}
	app := slatehttp.NewApp(staticFS, db, cfg.CookieSecure, auth.Options{
		InviteCode:          cfg.InviteCode,
		AppBaseURL:          cfg.AppBaseURL,
		PasswordResetSender: passwordResetSender,
	})
	go app.RunPasswordResetWorker(ctx)
	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           slatehttp.WithRequestTimeout(app.Routes(), cfg.RequestTimeout),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       cfg.HTTPIdleTimeout,
	}

	errs := make(chan error, 1)
	go func() {
		slog.Info("serving slate",
			"addr", server.Addr,
			"app_max_instances", cfg.AppMaxInstances,
			"db_pool_max_connections", db.MaxConnections(),
			"db_connection_allowance", cfg.DBConnectionAllowance,
			"db_reserved_connections", cfg.DBReservedConnections,
			"db_acquire_timeout", cfg.DBAcquireTimeout,
			"db_statement_timeout", cfg.DBStatementTimeout,
			"request_timeout", cfg.RequestTimeout,
		)
		errs <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	case err := <-errs:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func accounts(cfg config.Config, args []string) error {
	if len(args) == 0 {
		return usage()
	}
	db, err := openDB(cfg)
	if err != nil {
		return err
	}
	defer db.Close()
	if _, err := migrations.Apply(context.Background(), db); err != nil {
		return err
	}
	store := auth.NewPGStore(db)
	switch args[0] {
	case "list":
		if len(args) != 1 {
			return errors.New("usage: slate accounts list")
		}
		members, err := store.ListMembers(context.Background())
		if err != nil {
			return err
		}
		fmt.Println("EMAIL\tSTATUS\tCREATED")
		for _, member := range members {
			status := "enabled"
			if member.DisabledAt != nil {
				status = "disabled"
			}
			fmt.Printf("%s\t%s\t%s\n", member.Email, status, member.CreatedAt.UTC().Format(time.RFC3339))
		}
		return nil
	case "disable", "enable":
		if len(args) != 2 || strings.TrimSpace(args[1]) == "" {
			return fmt.Errorf("usage: slate accounts %s <email>", args[0])
		}
		disabled := args[0] == "disable"
		if err := store.SetMemberDisabled(context.Background(), args[1], disabled); err != nil {
			return err
		}
		fmt.Printf("%s %s\n", args[0]+"d", strings.ToLower(strings.TrimSpace(args[1])))
		return nil
	default:
		return usage()
	}
}

func migrate(cfg config.Config) error {
	db, err := openDB(cfg)
	if err != nil {
		return err
	}
	defer db.Close()

	applied, err := migrations.Apply(context.Background(), db)
	if err != nil {
		return err
	}
	if len(applied) == 0 {
		fmt.Println("migrations already up to date")
		return nil
	}
	for _, version := range applied {
		fmt.Println(version)
	}
	return nil
}

func cleanupOperationalData(cfg config.Config) error {
	db, err := openDB(cfg)
	if err != nil {
		return err
	}
	defer db.Close()
	if _, err := migrations.Apply(context.Background(), db); err != nil {
		return err
	}
	report, cleanupErr := cleanup.Run(context.Background(), db, time.Now().UTC(), cleanup.DefaultBatchSize)
	if err := json.NewEncoder(os.Stdout).Encode(report); err != nil {
		return err
	}
	return cleanupErr
}

func seedAdmin(cfg config.Config) error {
	if cfg.AdminEmail == "" || cfg.AdminPassword == "" {
		return errors.New("ADMIN_EMAIL and ADMIN_PASSWORD are required")
	}
	db, err := openDB(cfg)
	if err != nil {
		return err
	}
	defer db.Close()

	if _, err := migrations.Apply(context.Background(), db); err != nil {
		return err
	}
	authStore := auth.NewPGStore(db)
	user, err := auth.SeedAdmin(context.Background(), authStore, cfg.AdminEmail, cfg.AdminPassword)
	if errors.Is(err, auth.ErrAdminExists) {
		fmt.Println("admin already exists")
		return nil
	}
	if err != nil {
		return err
	}
	if err := boards.NewStore(db).SeedDefaultBoard(context.Background(), user.ID); err != nil {
		return err
	}
	fmt.Printf("seeded admin %s\n", user.Email)
	return nil
}

func openDB(cfg config.Config) (*database.Pool, error) {
	if cfg.DatabaseURL == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	db, err := database.Open(context.Background(), cfg.DatabaseURL, database.Options{
		MaxConnections:         cfg.DBMaxConnections,
		AcquireTimeout:         cfg.DBAcquireTimeout,
		StatementTimeout:       cfg.DBStatementTimeout,
		IdleTransactionTimeout: cfg.DBIdleTransactionTimeout,
		MaxConnectionIdleTime:  cfg.DBMaxConnectionIdleTime,
		MaxConnectionLifetime:  cfg.DBMaxConnectionLifetime,
	})
	if err != nil {
		return nil, fmt.Errorf("connect database: %w", err)
	}
	if err := verifyDatabaseCapacity(context.Background(), db, cfg); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func verifyDatabaseCapacity(ctx context.Context, db *database.Pool, cfg config.Config) error {
	maximum, current, err := db.ServerCapacity(ctx)
	if err != nil {
		return fmt.Errorf("inspect database capacity: %w", err)
	}
	if maximum < cfg.DBConnectionAllowance {
		return fmt.Errorf("unsafe database capacity: server max_connections is %d, below configured allowance %d", maximum, cfg.DBConnectionAllowance)
	}
	slog.Info("database capacity verified",
		"server_max_connections", maximum,
		"current_connections", current,
		"configured_allowance", cfg.DBConnectionAllowance,
		"reserved_connections", cfg.DBReservedConnections,
	)
	return nil
}
