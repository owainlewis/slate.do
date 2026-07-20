package auth

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/entitlements"
	"github.com/owainlewis/slate.do/server/internal/migrations"
)

func TestPGStoreResolvesProEntitlementForEveryAuthenticationPath(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run auth store integration tests")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := migrations.Apply(ctx, db); err != nil {
		t.Fatal(err)
	}

	store := NewPGStore(db)
	email := fmt.Sprintf("pro-auth-%d@slate.test", time.Now().UnixNano())
	admin, err := store.CreateAdmin(ctx, email, "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", admin.ID) })
	assertProAdminEntitlement(t, admin)

	byEmail, err := store.FindUserByEmail(ctx, email)
	if err != nil {
		t.Fatal(err)
	}
	assertProAdminEntitlement(t, byEmail.User)

	expiresAt := time.Now().Add(time.Hour)
	sessionHash := fmt.Sprintf("session-hash-%d", time.Now().UnixNano())
	if err := store.CreateSession(ctx, admin.ID, sessionHash, expiresAt); err != nil {
		t.Fatal(err)
	}
	bySession, err := store.FindUserBySessionHash(ctx, sessionHash, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	assertProAdminEntitlement(t, bySession)

	apiHash := fmt.Sprintf("api-hash-%d", time.Now().UnixNano())
	if _, err := store.CreateAPIToken(ctx, admin.ID, "test", apiHash); err != nil {
		t.Fatal(err)
	}
	byToken, err := store.FindUserByAPITokenHash(ctx, apiHash, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	assertProAdminEntitlement(t, byToken)
}

func assertProAdminEntitlement(t *testing.T, user User) {
	t.Helper()
	if user.Role != "admin" || user.Entitlement.Plan != entitlements.PlanPro || user.Entitlement.Source != entitlements.SourceAdmin {
		t.Fatalf("user access = %#v", user)
	}
	if user.Entitlement.Limits != entitlements.ProLimits {
		t.Fatalf("limits = %#v, want %#v", user.Entitlement.Limits, entitlements.ProLimits)
	}
}
