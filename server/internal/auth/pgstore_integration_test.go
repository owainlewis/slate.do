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
	"github.com/owainlewis/slate.do/server/internal/httpapi"
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
	agent, err := store.CreateAgent(ctx, user.ID, "Operator Bot", "", "agent-hash", "slate_agent_operator")
	if err != nil {
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
	if _, err := store.FindUserByAPITokenHash(ctx, "agent-hash", time.Now()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("disabled agent token error = %v", err)
	}
	if _, err := store.FindUserByEmail(ctx, email); !errors.Is(err, ErrInvalidAuth) {
		t.Fatalf("disabled password lookup error = %v", err)
	}
	if err := store.CreateSession(ctx, user.ID, string(passwordHash), "disabled-session", time.Now().Add(time.Hour)); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("session creation while disabled error = %v, want ErrUnauthorized", err)
	}
	if _, err := store.CreateAPIToken(ctx, user.ID, "disabled-token", "disabled-api-hash"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("API token creation while disabled error = %v, want ErrUnauthorized", err)
	}
	if _, err := store.CreateAgent(ctx, user.ID, "Disabled Bot", "", "disabled-agent-hash", "slate_agent_disabled"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("agent creation while disabled error = %v, want ErrUnauthorized", err)
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
	if _, err := store.FindUserByAPITokenHash(ctx, "agent-hash", time.Now()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("revoked agent token restored after enable: %v", err)
	}
	agents, err := store.ListAgents(ctx, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(agents) != 1 || agents[0].ID != agent.ID || agents[0].RevokedAt == nil {
		t.Fatalf("disabled account agent = %#v", agents)
	}
}

func TestPasswordResetTokensAreSingleUseAndRevokeSessions(t *testing.T) {
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
	email := fmt.Sprintf("reset-%d@slate.test", time.Now().UnixNano())
	user, err := store.CreateAdmin(ctx, email, "old-password-hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", user.ID) })
	now := time.Now().UTC()
	if err := store.CreateSession(ctx, user.ID, "old-password-hash", "active-session", now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := store.CreatePasswordResetToken(ctx, email, "old-token", now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := store.CreatePasswordResetToken(ctx, email, "current-token", now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if valid, err := store.PasswordResetTokenValid(ctx, "current-token", now); err != nil || !valid {
		t.Fatalf("current token valid = %v, error = %v", valid, err)
	}
	if err := store.ResetPassword(ctx, "old-token", "new-password-hash", now); !errors.Is(err, ErrInvalidResetToken) {
		t.Fatalf("superseded token error = %v", err)
	}
	if err := store.ResetPassword(ctx, "current-token", "new-password-hash", now); err != nil {
		t.Fatal(err)
	}
	account, err := store.FindUserByEmail(ctx, email)
	if err != nil || account.PasswordHash != "new-password-hash" {
		t.Fatalf("updated account = %#v, error = %v", account, err)
	}
	var sessions int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM sessions WHERE user_id = $1", user.ID).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if sessions != 0 {
		t.Fatalf("sessions = %d, want 0", sessions)
	}
	if err := store.ResetPassword(ctx, "current-token", "another-password-hash", now); !errors.Is(err, ErrInvalidResetToken) {
		t.Fatalf("reused token error = %v", err)
	}
	if err := store.CreatePasswordResetToken(ctx, email, "expired-token", now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := store.ResetPassword(ctx, "expired-token", "another-password-hash", now); !errors.Is(err, ErrInvalidResetToken) {
		t.Fatalf("expired token error = %v", err)
	}

	if err := store.QueuePasswordResetRequest(ctx, "unknown@example.com", now); err != nil {
		t.Fatal(err)
	}
	request, err := store.ClaimPasswordResetRequest(ctx, now)
	if err != nil || request.Email != "unknown@example.com" || request.Attempts != 1 {
		t.Fatalf("claimed request = %#v, error = %v", request, err)
	}
	retryAt := now.Add(time.Minute)
	if err := store.RetryPasswordResetRequest(ctx, request.ID, retryAt); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimPasswordResetRequest(ctx, now); !errors.Is(err, ErrNoPendingReset) {
		t.Fatalf("early retry error = %v", err)
	}
	retried, err := store.ClaimPasswordResetRequest(ctx, retryAt)
	if err != nil || retried.ID != request.ID || retried.Attempts != 2 {
		t.Fatalf("retried request = %#v, error = %v", retried, err)
	}
	if err := store.CompletePasswordResetRequest(ctx, retried.ID, retryAt); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimPasswordResetRequest(ctx, retryAt); !errors.Is(err, ErrNoPendingReset) {
		t.Fatalf("completed request claim error = %v", err)
	}

	for attempt := 1; attempt <= passwordConfirmLimit; attempt++ {
		if _, err := store.ConsumePasswordResetConfirmationAttempt(ctx, "ip-"+user.ID, "token-"+user.ID, now, passwordConfirmWindow, passwordConfirmLimit); err != nil {
			t.Fatalf("confirmation attempt %d: %v", attempt, err)
		}
	}
	if _, err := store.ConsumePasswordResetConfirmationAttempt(ctx, "ip-"+user.ID, "token-"+user.ID, now, passwordConfirmWindow, passwordConfirmLimit); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("confirmation rate limit error = %v", err)
	}
}

func TestPasswordResetSerializesWithStaleLoginSessionCreation(t *testing.T) {
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
	email := fmt.Sprintf("reset-race-%d@slate.test", time.Now().UnixNano())
	currentHash := "password-hash-0"
	user, err := store.CreateAdmin(ctx, email, currentHash)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", user.ID) })

	for iteration := 1; iteration <= 20; iteration++ {
		now := time.Now().UTC()
		tokenHash := fmt.Sprintf("reset-race-token-%d-%d", now.UnixNano(), iteration)
		sessionHash := fmt.Sprintf("reset-race-session-%d-%d", now.UnixNano(), iteration)
		newHash := fmt.Sprintf("password-hash-%d", iteration)
		if err := store.CreatePasswordResetToken(ctx, email, tokenHash, now.Add(time.Hour)); err != nil {
			t.Fatal(err)
		}

		start := make(chan struct{})
		var wait sync.WaitGroup
		wait.Add(2)
		var resetErr, sessionErr error
		go func(expectedHash string) {
			defer wait.Done()
			<-start
			sessionErr = store.CreateSession(ctx, user.ID, expectedHash, sessionHash, now.Add(time.Hour))
		}(currentHash)
		go func() {
			defer wait.Done()
			<-start
			resetErr = store.ResetPassword(ctx, tokenHash, newHash, now)
		}()
		close(start)
		wait.Wait()

		if resetErr != nil {
			t.Fatalf("iteration %d reset: %v", iteration, resetErr)
		}
		if sessionErr != nil && !errors.Is(sessionErr, ErrUnauthorized) {
			t.Fatalf("iteration %d session: %v", iteration, sessionErr)
		}
		if _, err := store.FindUserBySessionHash(ctx, sessionHash, now); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("iteration %d stale login session survived reset: %v", iteration, err)
		}
		currentHash = newHash
	}
}

func TestDisableSerializesWithSessionAPITokenAndAgentCreation(t *testing.T) {
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
		if _, err := db.Exec(ctx, "DELETE FROM agents WHERE owner_user_id = $1", user.ID); err != nil {
			t.Fatal(err)
		}
		sessionHash := fmt.Sprintf("race-session-%d-%d", time.Now().UnixNano(), iteration)
		tokenHash := fmt.Sprintf("race-token-%d-%d", time.Now().UnixNano(), iteration)
		agentHash := fmt.Sprintf("race-agent-%d-%d", time.Now().UnixNano(), iteration)
		start := make(chan struct{})
		var wait sync.WaitGroup
		wait.Add(4)
		var disableErr, sessionErr, tokenErr, agentErr error
		var agent AgentUser
		go func() {
			defer wait.Done()
			<-start
			disableErr = store.SetMemberDisabled(ctx, email, true)
		}()
		go func() {
			defer wait.Done()
			<-start
			sessionErr = store.CreateSession(ctx, user.ID, "hash", sessionHash, time.Now().Add(time.Hour))
		}()
		go func() {
			defer wait.Done()
			<-start
			_, tokenErr = store.CreateAPIToken(ctx, user.ID, "race", tokenHash)
		}()
		go func() {
			defer wait.Done()
			<-start
			agent, agentErr = store.CreateAgent(ctx, user.ID, fmt.Sprintf("Race Agent %d", iteration), "", agentHash, "slate_agent_race")
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
		if agentErr != nil && !errors.Is(agentErr, ErrUnauthorized) {
			t.Fatalf("iteration %d agent: %v", iteration, agentErr)
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
		if _, err := store.FindUserByAPITokenHash(ctx, agentHash, time.Now()); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("iteration %d agent token survived re-enable: %v", iteration, err)
		}
		if agentErr == nil {
			if err := store.DeleteAgent(ctx, user.ID, agent.ID); err != nil {
				t.Fatalf("iteration %d delete agent: %v", iteration, err)
			}
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
	if err := store.CreateSession(ctx, admin.ID, "hash", "force-signup-rollback", time.Now().Add(time.Hour)); err != nil {
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
	if err := store.CreateSession(ctx, admin.ID, "hash", sessionHash, expiresAt); err != nil {
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

	theme := "dark"
	displayName := "Updated Owner"
	updated, err := store.UpdateProfile(ctx, admin.ID, &theme, &displayName)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Theme != theme || updated.DisplayName != displayName {
		t.Fatalf("updated profile = %#v", updated)
	}
	persisted, err := store.FindUserByEmail(ctx, email)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.User.Theme != theme || persisted.User.DisplayName != displayName {
		t.Fatalf("persisted profile = %#v", persisted.User)
	}
}

func TestPGStoreDefaultsMissingEntitlementToFreeAndMeasuresUsage(t *testing.T) {
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
	email := fmt.Sprintf("free-auth-%d@slate.test", time.Now().UnixNano())
	setupTx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer setupTx.Rollback(ctx)
	var userID, inboxBoardID string
	if err := setupTx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, role)
		VALUES ($1, 'hash', 'member')
		RETURNING id::text
	`, email).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := setupTx.QueryRow(ctx, `
		INSERT INTO boards (user_id, name) VALUES ($1, 'Today')
		RETURNING id::text
	`, userID).Scan(&inboxBoardID); err != nil {
		t.Fatal(err)
	}
	if _, err := setupTx.Exec(ctx, `
		INSERT INTO buckets (board_id, name, is_inbox)
		VALUES ($1, 'Inbox', true)
	`, inboxBoardID); err != nil {
		t.Fatal(err)
	}
	if err := setupTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID) })

	byEmail, err := store.FindUserByEmail(ctx, email)
	if err != nil {
		t.Fatal(err)
	}
	assertFreeEntitlement(t, byEmail.User)

	sessionHash := fmt.Sprintf("free-session-%d", time.Now().UnixNano())
	if err := store.CreateSession(ctx, userID, "hash", sessionHash, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	bySession, err := store.FindUserBySessionHash(ctx, sessionHash, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	assertFreeEntitlement(t, bySession)

	type tokenResult struct {
		hash string
		err  error
	}
	const attempts = 8
	start := make(chan struct{})
	results := make(chan tokenResult, attempts)
	var workers sync.WaitGroup
	for index := 1; index <= attempts; index++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			<-start
			hash := fmt.Sprintf("free-api-%d-%d", time.Now().UnixNano(), index)
			_, err := store.CreateAPIToken(ctx, userID, fmt.Sprintf("Token %d", index), hash)
			results <- tokenResult{hash: hash, err: err}
		}(index)
	}
	close(start)
	workers.Wait()
	close(results)

	created := make([]string, 0, entitlements.FreeLimits.APITokens)
	limited := 0
	for result := range results {
		switch {
		case result.err == nil:
			created = append(created, result.hash)
		case errors.Is(result.err, ErrAPITokenLimit):
			limited++
		default:
			t.Fatalf("concurrent free API token error = %v", result.err)
		}
	}
	if len(created) != entitlements.FreeLimits.APITokens || limited != attempts-entitlements.FreeLimits.APITokens {
		t.Fatalf("concurrent token results: created = %d, limited = %d", len(created), limited)
	}
	byToken, err := store.FindUserByAPITokenHash(ctx, created[0], time.Now())
	if err != nil {
		t.Fatal(err)
	}
	assertFreeEntitlement(t, byToken)

	agentName := strings.Repeat("🙂", httpapi.AgentNameRunes)
	agentPurpose := strings.Repeat("é", httpapi.AgentInstructionsBytes/2)
	createdAgent, err := store.CreateAgent(ctx, userID, agentName, agentPurpose, fmt.Sprintf("free-agent-%d", time.Now().UnixNano()), "slate_agent_free")
	if err != nil {
		t.Fatal(err)
	}
	if createdAgent.DisplayName != agentName || createdAgent.Purpose != agentPurpose {
		t.Fatalf("agent text lengths = %d/%d", len([]rune(createdAgent.DisplayName)), len([]byte(createdAgent.Purpose)))
	}
	if _, err := store.CreateAgent(ctx, userID, "Second Agent", "", fmt.Sprintf("free-agent-over-%d", time.Now().UnixNano()), "slate_agent_over"); !errors.Is(err, ErrAgentLimit) {
		t.Fatalf("second free agent error = %v", err)
	}

	var boardID, bucketID string
	if err := db.QueryRow(ctx, `INSERT INTO boards (user_id, name) VALUES ($1, 'Free board') RETURNING id::text`, userID).Scan(&boardID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `INSERT INTO buckets (board_id, name) VALUES ($1, 'Free list') RETURNING id::text`, boardID).Scan(&bucketID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, description, kind, status)
		VALUES
			($1, $2, 'é', '🙂', 'action', 'queued'),
			($1, $2, 'abc', '', 'action', 'done')
	`, boardID, bucketID); err != nil {
		t.Fatal(err)
	}
	usage, err := store.AccountUsage(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if usage.Boards != 2 || usage.MaxListsPerBoard != 1 || usage.MaxActiveItemsPerList != 1 || usage.Agents != 1 || usage.StoredTasks != 2 || usage.StoredContentBytes != 9 || usage.APITokens != 3 {
		t.Fatalf("free usage = %#v", usage)
	}

	theme := "dark"
	updated, err := store.UpdateProfile(ctx, userID, &theme, nil)
	if err != nil {
		t.Fatal(err)
	}
	assertFreeEntitlement(t, updated)
}

func TestAgentTokensAuthenticateAsAccountScopedRevocableIdentities(t *testing.T) {
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
	email := fmt.Sprintf("agent-owner-%d@slate.test", time.Now().UnixNano())
	owner, err := store.CreateAdmin(ctx, email, "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", owner.ID) })

	tokenHash := fmt.Sprintf("agent-token-%d", time.Now().UnixNano())
	agent, err := store.CreateAgent(ctx, owner.ID, "Research Bot", "Research customer needs", tokenHash, "slate_agent_research")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateAgent(ctx, owner.ID, " research bot ", "", tokenHash+"-duplicate", "slate_agent_duplicate"); !errors.Is(err, ErrAgentNameTaken) {
		t.Fatalf("case-insensitive duplicate name error = %v", err)
	}
	for index := 2; index <= entitlements.ProLimits.Agents; index++ {
		if _, err := store.CreateAgent(
			ctx,
			owner.ID,
			fmt.Sprintf("Agent %d", index),
			"",
			fmt.Sprintf("%s-%d", tokenHash, index),
			fmt.Sprintf("slate_agent_%d", index),
		); err != nil {
			t.Fatalf("create active agent %d: %v", index, err)
		}
	}
	if _, err := store.CreateAgent(ctx, owner.ID, "Over limit", "", tokenHash+"-limit", "slate_agent_limit"); !errors.Is(err, ErrAgentLimit) {
		t.Fatalf("sixth active agent error = %v", err)
	}

	identity, err := store.FindUserByAPITokenHash(ctx, tokenHash, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if identity.ID != owner.ID || identity.AgentID != agent.ID || identity.Role != "agent" || identity.DisplayName != agent.DisplayName || identity.AgentPurpose != agent.Purpose || identity.Email != "" {
		t.Fatalf("agent identity = %#v", identity)
	}
	if identity.Entitlement.Plan != entitlements.PlanPro {
		t.Fatalf("agent entitlement = %#v", identity.Entitlement)
	}

	var boardID string
	if err := db.QueryRow(ctx, `
		INSERT INTO boards (user_id, name)
		VALUES ($1, 'Agent count board')
		RETURNING id::text
	`, owner.ID).Scan(&boardID); err != nil {
		t.Fatal(err)
	}
	var bucketID string
	if err := db.QueryRow(ctx, `
		INSERT INTO buckets (board_id, name)
		VALUES ($1, 'Agent count list')
		RETURNING id::text
	`, boardID).Scan(&bucketID); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		status string
	}{
		{status: "queued"},
		{status: "working"},
		{status: "needs_review"},
		{status: "done"},
	} {
		if _, err := db.Exec(ctx, `
			INSERT INTO tasks (board_id, bucket_id, title, status, assignee_agent_id)
			VALUES ($1, $2, $3, $4, $5)
		`, boardID, bucketID, "Count "+item.status, item.status, agent.ID); err != nil {
			t.Fatal(err)
		}
	}
	other, err := store.CreateAdmin(ctx, fmt.Sprintf("agent-count-other-%d@slate.test", time.Now().UnixNano()), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", other.ID) })
	var otherBoardID string
	if err := db.QueryRow(ctx, `
		INSERT INTO boards (user_id, name)
		VALUES ($1, 'Other owner board')
		RETURNING id::text
	`, other.ID).Scan(&otherBoardID); err != nil {
		t.Fatal(err)
	}
	var otherBucketID string
	if err := db.QueryRow(ctx, `
		INSERT INTO buckets (board_id, name)
		VALUES ($1, 'Other owner list')
		RETURNING id::text
	`, otherBoardID).Scan(&otherBucketID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, status, assignee_agent_id)
		VALUES ($1, $2, 'Must not count', 'working', $3)
	`, otherBoardID, otherBucketID, agent.ID); err != nil {
		t.Fatal(err)
	}
	counted, err := store.ListAgents(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	var countedAgent AgentUser
	for _, listed := range counted {
		if listed.ID == agent.ID {
			countedAgent = listed
			break
		}
	}
	if countedAgent.WorkCounts != (AgentWorkCounts{Ready: 1, Working: 1, Review: 1}) {
		t.Fatalf("owner-scoped work counts = %#v", countedAgent.WorkCounts)
	}

	if err := store.RevokeAgentToken(ctx, owner.ID, agent.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateAgent(ctx, owner.ID, "Replacement before delete", "", tokenHash+"-revoked", "slate_agent_revoked"); !errors.Is(err, ErrAgentLimit) {
		t.Fatalf("revoked agent should still consume slot: %v", err)
	}
	if _, err := store.FindUserByAPITokenHash(ctx, tokenHash, time.Now()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("revoked agent token error = %v", err)
	}
	if err := store.DeleteAgent(ctx, "00000000-0000-0000-0000-000000000000", agent.ID); !errors.Is(err, ErrAgentNotFound) {
		t.Fatalf("cross-account delete error = %v", err)
	}
	if err := store.DeleteAgent(ctx, owner.ID, agent.ID); err != nil {
		t.Fatal(err)
	}
	agents, err := store.ListAgents(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(agents) != entitlements.ProLimits.Agents-1 {
		t.Fatalf("agent list after delete = %#v", agents)
	}
	for _, listed := range agents {
		if listed.ID == agent.ID {
			t.Fatalf("deleted agent still listed = %#v", listed)
		}
	}
	if _, err := store.GetAgent(ctx, owner.ID, agent.ID); !errors.Is(err, ErrAgentNotFound) {
		t.Fatalf("deleted agent lookup error = %v", err)
	}
	var taskCount, unassignedCount int
	if err := db.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE assignee_agent_id IS NULL)
		FROM tasks
		WHERE board_id IN ($1, $2)
	`, boardID, otherBoardID).Scan(&taskCount, &unassignedCount); err != nil {
		t.Fatal(err)
	}
	if taskCount != 5 || unassignedCount != taskCount {
		t.Fatalf("tasks after agent delete = %d total, %d unassigned", taskCount, unassignedCount)
	}
	var credentialCount int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM agent_credentials WHERE agent_id = $1", agent.ID).Scan(&credentialCount); err != nil {
		t.Fatal(err)
	}
	if credentialCount != 0 {
		t.Fatalf("credentials after agent delete = %d", credentialCount)
	}
	replacement, err := store.CreateAgent(ctx, owner.ID, "Replacement Bot", "", tokenHash+"-replacement", "slate_agent_replacement")
	if err != nil {
		t.Fatalf("replacement after delete: %v", err)
	}
	if replacement.ID == agent.ID {
		t.Fatalf("replacement reused deleted identity: %#v", replacement)
	}
}

func TestConcurrentAgentCreationCannotExceedProActiveAgentLimit(t *testing.T) {
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
	owner, err := store.CreateAdmin(ctx, fmt.Sprintf("agent-race-%d@slate.test", time.Now().UnixNano()), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", owner.ID) })

	const attempts = 12
	results := make(chan error, attempts)
	var start sync.WaitGroup
	start.Add(1)
	var workers sync.WaitGroup
	for index := range attempts {
		workers.Add(1)
		go func() {
			defer workers.Done()
			start.Wait()
			_, err := store.CreateAgent(
				ctx,
				owner.ID,
				fmt.Sprintf("Agent %d", index),
				"",
				fmt.Sprintf("agent-race-token-%d-%d", time.Now().UnixNano(), index),
				fmt.Sprintf("slate_agent_%d", index),
			)
			results <- err
		}()
	}
	start.Done()
	workers.Wait()
	close(results)

	successes := 0
	limits := 0
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrAgentLimit):
			limits++
		default:
			t.Fatalf("unexpected concurrent creation error: %v", err)
		}
	}
	if successes != entitlements.ProLimits.Agents || limits != attempts-entitlements.ProLimits.Agents {
		t.Fatalf("concurrent results = %d success, %d limits", successes, limits)
	}
	var liveAgents int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM agents WHERE owner_user_id = $1 AND archived_at IS NULL", owner.ID).Scan(&liveAgents); err != nil {
		t.Fatal(err)
	}
	if liveAgents != entitlements.ProLimits.Agents {
		t.Fatalf("live agents = %d, want %d", liveAgents, entitlements.ProLimits.Agents)
	}
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

func assertFreeEntitlement(t *testing.T, user User) {
	t.Helper()
	if user.Role != "member" || user.Entitlement != entitlements.Free() {
		t.Fatalf("free entitlement = %#v", user)
	}
}
