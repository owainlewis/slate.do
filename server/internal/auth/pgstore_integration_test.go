package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/entitlements"
	"github.com/owainlewis/slate.do/server/internal/migrations"
	"golang.org/x/crypto/bcrypt"
)

func TestInviteSignupIsAtomicRateLimitedAndDisableable(t *testing.T) {
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
	email := fmt.Sprintf("invited-%d@slate.test", time.Now().UnixNano())
	password := "a secure password"
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.CreateInvitedMember(ctx, email, string(passwordHash), "session-hash", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", user.ID) })
	if user.Role != "member" || user.Entitlement.Plan != entitlements.PlanPro || user.Entitlement.Source != entitlements.SourceInviteCode || user.Entitlement.Limits != entitlements.ProLimits {
		t.Fatalf("invited access = %#v", user)
	}
	var boards, lists, sessions int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM boards WHERE user_id = $1", user.ID).Scan(&boards); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, "SELECT count(*) FROM buckets WHERE board_id IN (SELECT id FROM boards WHERE user_id = $1)", user.ID).Scan(&lists); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, "SELECT count(*) FROM sessions WHERE user_id = $1", user.ID).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if boards != 1 || lists != 5 || sessions != 1 {
		t.Fatalf("created boards/lists/sessions = %d/%d/%d, want 1/5/1", boards, lists, sessions)
	}
	rotatedService := NewService(store, false, "a-new-invite-code")
	loginRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(fmt.Sprintf(`{"email":%q,"password":%q}`, email, password)))
	loginRecorder := httptest.NewRecorder()
	rotatedService.Login(loginRecorder, loginRequest)
	if loginRecorder.Code != http.StatusOK || len(loginRecorder.Result().Cookies()) != 1 {
		t.Fatalf("login after invite rotation = %d %s", loginRecorder.Code, loginRecorder.Body.String())
	}

	if _, err := store.CreateInvitedMember(ctx, email, "other", "other-session", time.Now().Add(time.Hour)); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("duplicate error = %v, want ErrEmailTaken", err)
	}

	secondStore := NewPGStore(db)
	now := time.Now().UTC()
	rateKey := fmt.Sprintf("shared-ip-%d", time.Now().UnixNano())
	for attempt := 1; attempt <= signupLimit; attempt++ {
		if _, err := store.ConsumeSignupAttempt(ctx, rateKey, "email-a-"+rateKey, now, signupWindow, signupLimit); err != nil {
			t.Fatalf("attempt %d: %v", attempt, err)
		}
	}
	if retry, err := secondStore.ConsumeSignupAttempt(ctx, rateKey, "email-b-"+rateKey, now, signupWindow, signupLimit); !errors.Is(err, ErrRateLimited) || retry <= 0 {
		t.Fatalf("cross-instance rate limit = %v, retry %v", err, retry)
	}

	if _, err := store.CreateAPIToken(ctx, user.ID, "operator-test", "api-hash"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetMemberDisabled(ctx, email, true); err != nil {
		t.Fatal(err)
	}
	if _, err := store.FindUserBySessionHash(ctx, "session-hash", time.Now()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("disabled session error = %v", err)
	}
	if _, err := store.FindUserByAPITokenHash(ctx, "api-hash", time.Now()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("disabled API token error = %v", err)
	}
	if _, err := store.FindUserByEmail(ctx, email); !errors.Is(err, ErrInvalidAuth) {
		t.Fatalf("disabled password lookup error = %v", err)
	}
	if err := store.CreateSession(ctx, user.ID, "disabled-session", time.Now().Add(time.Hour)); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("session creation while disabled error = %v, want ErrUnauthorized", err)
	}
	if _, err := store.CreateAPIToken(ctx, user.ID, "disabled-token", "disabled-api-hash"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("API token creation while disabled error = %v, want ErrUnauthorized", err)
	}
	if err := store.SetMemberDisabled(ctx, email, false); err != nil {
		t.Fatal(err)
	}
	if _, err := store.FindUserByEmail(ctx, email); err != nil {
		t.Fatalf("re-enabled password lookup: %v", err)
	}
	if _, err := store.FindUserBySessionHash(ctx, "session-hash", time.Now()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("revoked session restored after enable: %v", err)
	}
}

func TestDisableSerializesWithSessionAndAPITokenCreation(t *testing.T) {
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
	email := fmt.Sprintf("disable-race-%d@slate.test", time.Now().UnixNano())
	user, err := store.CreateInvitedMember(ctx, email, "hash", fmt.Sprintf("initial-%d", time.Now().UnixNano()), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", user.ID) })

	for iteration := 0; iteration < 20; iteration++ {
		if err := store.SetMemberDisabled(ctx, email, false); err != nil {
			t.Fatal(err)
		}
		sessionHash := fmt.Sprintf("race-session-%d-%d", time.Now().UnixNano(), iteration)
		tokenHash := fmt.Sprintf("race-token-%d-%d", time.Now().UnixNano(), iteration)
		start := make(chan struct{})
		var wait sync.WaitGroup
		wait.Add(3)
		var disableErr, sessionErr, tokenErr error
		go func() {
			defer wait.Done()
			<-start
			disableErr = store.SetMemberDisabled(ctx, email, true)
		}()
		go func() {
			defer wait.Done()
			<-start
			sessionErr = store.CreateSession(ctx, user.ID, sessionHash, time.Now().Add(time.Hour))
		}()
		go func() {
			defer wait.Done()
			<-start
			_, tokenErr = store.CreateAPIToken(ctx, user.ID, "race", tokenHash)
		}()
		close(start)
		wait.Wait()
		if disableErr != nil {
			t.Fatalf("iteration %d disable: %v", iteration, disableErr)
		}
		if sessionErr != nil && !errors.Is(sessionErr, ErrUnauthorized) {
			t.Fatalf("iteration %d session: %v", iteration, sessionErr)
		}
		if tokenErr != nil && !errors.Is(tokenErr, ErrUnauthorized) {
			t.Fatalf("iteration %d token: %v", iteration, tokenErr)
		}
		if err := store.SetMemberDisabled(ctx, email, false); err != nil {
			t.Fatal(err)
		}
		if _, err := store.FindUserBySessionHash(ctx, sessionHash, time.Now()); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("iteration %d session survived re-enable: %v", iteration, err)
		}
		if _, err := store.FindUserByAPITokenHash(ctx, tokenHash, time.Now()); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("iteration %d API token survived re-enable: %v", iteration, err)
		}
	}
}

func TestInviteSignupRollsBackEveryRecordWhenSessionInsertFails(t *testing.T) {
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

	email := fmt.Sprintf("rollback-%d@slate.test", time.Now().UnixNano())
	store := NewPGStore(db)
	admin, err := store.CreateAdmin(ctx, fmt.Sprintf("rollback-admin-%d@slate.test", time.Now().UnixNano()), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", admin.ID) })
	if err := store.CreateSession(ctx, admin.ID, "force-signup-rollback", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateInvitedMember(ctx, email, "password-hash", "force-signup-rollback", time.Now().Add(time.Hour)); err == nil {
		t.Fatal("expected forced transaction failure")
	}
	var users int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM users WHERE email = $1", email).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 0 {
		t.Fatalf("partial signup left %d users", users)
	}
}

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
