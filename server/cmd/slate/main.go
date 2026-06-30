package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/boards"
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
	cfg := config.FromEnv()
	switch args[1] {
	case "serve":
		return serve(cfg)
	case "migrate":
		return migrate(cfg)
	case "seed-owner":
		return seedOwner(cfg)
	default:
		return usage()
	}
}

func usage() error {
	return errors.New("usage: slate serve|migrate|seed-owner")
}

func serve(cfg config.Config) error {
	if cfg.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer db.Close()

	staticFS, err := web.FileSystem(cfg.StaticDir)
	if err != nil {
		return err
	}

	app := slatehttp.NewApp(staticFS, db, cfg.CookieSecure)
	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           app.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errs := make(chan error, 1)
	go func() {
		slog.Info("serving slate", "addr", server.Addr)
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

func seedOwner(cfg config.Config) error {
	if cfg.OwnerEmail == "" || cfg.OwnerPassword == "" {
		return errors.New("OWNER_EMAIL and OWNER_PASSWORD are required")
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
	user, err := auth.SeedOwner(context.Background(), authStore, cfg.OwnerEmail, cfg.OwnerPassword)
	if errors.Is(err, auth.ErrOwnerExists) {
		fmt.Println("owner already exists")
		return nil
	}
	if err != nil {
		return err
	}
	if err := boards.NewStore(db).SeedDefaultBoard(context.Background(), user.ID); err != nil {
		return err
	}
	fmt.Printf("seeded owner %s\n", user.Email)
	return nil
}

func openDB(cfg config.Config) (*database.Pool, error) {
	if cfg.DatabaseURL == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	db, err := database.Open(context.Background(), cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("connect database: %w", err)
	}
	return db, nil
}
