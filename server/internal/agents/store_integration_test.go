package agents

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/boards"
	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/migrations"
)

func TestDetailAndWorkStayOwnerScopedGroupedAndBounded(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run agent detail integration tests")
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

	authStore := auth.NewPGStore(db)
	stamp := time.Now().UnixNano()
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-detail-owner-%d@slate.test", stamp), "password-hash")
	if err != nil {
		t.Fatal(err)
	}
	other, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-detail-other-%d@slate.test", stamp), "password-hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = ANY($1::uuid[])", []string{owner.ID, other.ID})
	})
	agent, err := authStore.CreateAgent(ctx, owner.ID, "Builder", "Ships focused work", "owner-agent-hash", "slate_agent_owner")
	if err != nil {
		t.Fatal(err)
	}
	foreignAgent, err := authStore.CreateAgent(ctx, other.ID, "Other builder", "", "other-agent-hash", "slate_agent_other")
	if err != nil {
		t.Fatal(err)
	}
	ownerBoard, ownerBucket := insertBoardAndBucket(t, ctx, db, owner.ID, "Owner board")
	foreignBoard, foreignBucket := insertBoardAndBucket(t, ctx, db, other.ID, "Other board")

	for index := range 55 {
		insertAssignedTask(t, ctx, db, ownerBoard, ownerBucket, agent.ID, fmt.Sprintf("Ready %02d", index), "queued", false, time.Now().Add(time.Duration(index)*time.Second))
	}
	insertAssignedTask(t, ctx, db, ownerBoard, ownerBucket, agent.ID, "Current working", "working", false, time.Now().Add(time.Hour))
	insertAssignedTask(t, ctx, db, ownerBoard, ownerBucket, agent.ID, "Waiting for review", "needs_review", false, time.Now().Add(2*time.Hour))
	for index := range 25 {
		insertAssignedTask(t, ctx, db, ownerBoard, ownerBucket, agent.ID, fmt.Sprintf("Completed %02d", index), "done", true, time.Now().Add(time.Duration(index)*time.Minute))
	}
	// Deliberately create an invalid cross-owner assignment. Every detail query
	// must still exclude it through the board owner join.
	insertAssignedTask(t, ctx, db, foreignBoard, foreignBucket, agent.ID, "Foreign task", "working", false, time.Now().Add(3*time.Hour))

	store := NewStore(db, authStore)
	detail, err := store.GetDetail(ctx, owner.ID, agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Agent.ID != agent.ID || detail.Agent.DisplayName != "Builder" {
		t.Fatalf("agent = %#v", detail.Agent)
	}
	if detail.Work.Totals != (WorkTotals{Ready: 55, Working: 1, Review: 1, Completed: 25}) {
		t.Fatalf("totals = %#v", detail.Work.Totals)
	}
	if got := len(detail.Work.Ready) + len(detail.Work.Working) + len(detail.Work.Review); got != InitialOpenLimit {
		t.Fatalf("initial open items = %d, want %d", got, InitialOpenLimit)
	}
	if len(detail.Work.Working) != 1 || len(detail.Work.Review) != 1 || len(detail.Work.Ready) != 48 {
		t.Fatalf("initial groups = ready %d, working %d, review %d", len(detail.Work.Ready), len(detail.Work.Working), len(detail.Work.Review))
	}
	if len(detail.Work.RecentlyCompleted) != InitialCompletedLimit || detail.Work.RecentlyCompleted[0].Title != "Completed 24" {
		t.Fatalf("recent completed = %d, first %#v", len(detail.Work.RecentlyCompleted), detail.Work.RecentlyCompleted[0])
	}

	first, err := store.ListWork(ctx, owner.ID, agent.ID, 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.ListWork(ctx, owner.ID, agent.ID, 2, 10)
	if err != nil {
		t.Fatal(err)
	}
	if first.Total != 82 || len(first.Items) != 10 || !first.HasNext || first.HasPrevious {
		t.Fatalf("first page = %#v", first)
	}
	if len(second.Items) != 10 || !second.HasNext || !second.HasPrevious || first.Items[9].ID == second.Items[0].ID {
		t.Fatalf("second page = %#v", second)
	}
	for _, item := range append(first.Items, second.Items...) {
		if item.Title == "Foreign task" {
			t.Fatal("cross-owner task leaked into work page")
		}
	}

	if _, err := store.GetDetail(ctx, owner.ID, foreignAgent.ID); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("foreign agent error = %v, want not found", err)
	}
	if _, err := store.GetDetail(ctx, owner.ID, "00000000-0000-0000-0000-000000000000"); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("missing agent error = %v, want not found", err)
	}
	if _, err := db.Exec(ctx, "UPDATE agents SET archived_at = now() WHERE id = $1", agent.ID); err != nil {
		t.Fatal(err)
	}
	archived, err := store.GetDetail(ctx, owner.ID, agent.ID)
	if err != nil || archived.Agent.ArchivedAt == nil || archived.Work.Totals.Completed != 25 {
		t.Fatalf("archived detail = %#v, error = %v", archived, err)
	}
}

func TestAgentLifecycleIsOwnerScopedTransactionalAndRetrySafe(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run agent lifecycle integration tests")
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

	authStore := auth.NewPGStore(db)
	store := NewStore(db, authStore)
	stamp := time.Now().UnixNano()
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-lifecycle-owner-%d@slate.test", stamp), "password-hash")
	if err != nil {
		t.Fatal(err)
	}
	other, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-lifecycle-other-%d@slate.test", stamp), "password-hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = ANY($1::uuid[])", []string{owner.ID, other.ID})
	})
	oldToken := fmt.Sprintf("old-agent-token-%d", stamp)
	agent, err := authStore.CreateAgent(ctx, owner.ID, "Builder", "Ships work", lifecycleHash(oldToken), "slate_agent_old")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := authStore.CreateAgent(ctx, other.ID, "Foreign", "", lifecycleHash("foreign"), "slate_agent_foreign")
	if err != nil {
		t.Fatal(err)
	}

	updated, err := store.UpdateAgent(ctx, owner.ID, agent.ID, "  Builder Prime  ", "  Focused delivery  ")
	if err != nil || updated.DisplayName != "Builder Prime" || updated.Purpose != "Focused delivery" {
		t.Fatalf("updated agent = %#v, error = %v", updated, err)
	}
	if _, err := store.UpdateAgent(ctx, owner.ID, foreign.ID, "Stolen", ""); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("cross-owner update error = %v", err)
	}
	duplicate, err := authStore.CreateAgent(ctx, owner.ID, "Other active", "", lifecycleHash("duplicate"), "slate_agent_duplicate")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateAgent(ctx, owner.ID, duplicate.ID, " builder prime ", ""); !errors.Is(err, auth.ErrAgentNameTaken) {
		t.Fatalf("case-insensitive duplicate error = %v", err)
	}

	newToken := fmt.Sprintf("slate_agent_%043d", stamp%1000000)
	credential, applied, err := store.RotateCredential(ctx, owner.ID, agent.ID, "rotation-key-0000000000000001", lifecycleHash(newToken), "slate_agent_new")
	if err != nil || !applied || credential.RevokedAt != nil {
		t.Fatalf("rotate credential = %#v, applied = %t, error = %v", credential, applied, err)
	}
	retried, applied, err := store.RotateCredential(ctx, owner.ID, agent.ID, "rotation-key-0000000000000001", lifecycleHash("discarded-server-token"), "discarded")
	if err != nil || applied || retried.ID != credential.ID {
		t.Fatalf("rotation retry = %#v, applied = %t, error = %v", retried, applied, err)
	}
	if _, _, err := store.RotateCredential(ctx, owner.ID, foreign.ID, "rotation-key-0000000000000001", lifecycleHash("other"), "other"); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("cross-agent rotation key reuse error = %v", err)
	}
	if _, err := authStore.FindUserByAPITokenHash(ctx, lifecycleHash(oldToken), time.Now()); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatalf("old credential still authenticates: %v", err)
	}
	identity, err := authStore.FindUserByAPITokenHash(ctx, lifecycleHash(newToken), time.Now())
	if err != nil || identity.AgentID != agent.ID {
		t.Fatalf("new credential identity = %#v, error = %v", identity, err)
	}
	if _, _, err := store.RotateCredential(ctx, owner.ID, foreign.ID, "rotation-key-0000000000000002", lifecycleHash("other"), "other"); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("cross-owner rotation error = %v", err)
	}
	if err := store.RevokeCredential(ctx, owner.ID, agent.ID); err != nil {
		t.Fatal(err)
	}
	var revokedUpdatedAt time.Time
	if err := db.QueryRow(ctx, "SELECT updated_at FROM agent_credentials WHERE id = $1", credential.ID).Scan(&revokedUpdatedAt); err != nil {
		t.Fatal(err)
	}
	if err := store.RevokeCredential(ctx, owner.ID, agent.ID); err != nil {
		t.Fatalf("idempotent revoke: %v", err)
	}
	var repeatedRevokeUpdatedAt time.Time
	if err := db.QueryRow(ctx, "SELECT updated_at FROM agent_credentials WHERE id = $1", credential.ID).Scan(&repeatedRevokeUpdatedAt); err != nil {
		t.Fatal(err)
	}
	if !repeatedRevokeUpdatedAt.Equal(revokedUpdatedAt) {
		t.Fatalf("repeated revoke changed metadata: first %s, second %s", revokedUpdatedAt, repeatedRevokeUpdatedAt)
	}
	if err := store.RevokeCredential(ctx, owner.ID, foreign.ID); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("cross-owner revoke error = %v", err)
	}
	if _, err := authStore.FindUserByAPITokenHash(ctx, lifecycleHash(newToken), time.Now()); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatalf("revoked credential still authenticates: %v", err)
	}
	preArchiveToken := fmt.Sprintf("pre-archive-token-%d", stamp)
	preArchiveCredential, applied, err := store.RotateCredential(
		ctx, owner.ID, agent.ID, "rotation-key-0000000000000004",
		lifecycleHash(preArchiveToken), "slate_agent_pre_archive",
	)
	if err != nil || !applied {
		t.Fatalf("pre-archive rotation = %#v, applied = %t, error = %v", preArchiveCredential, applied, err)
	}
	if _, err := authStore.FindUserByAPITokenHash(ctx, lifecycleHash(preArchiveToken), time.Now()); err != nil {
		t.Fatalf("pre-archive credential does not authenticate: %v", err)
	}

	boardID, bucketID := insertBoardAndBucket(t, ctx, db, owner.ID, "Lifecycle board")
	readyID := insertLifecycleTask(t, ctx, db, boardID, bucketID, agent.ID, "Ready", "queued", false)
	workingID := insertLifecycleTask(t, ctx, db, boardID, bucketID, agent.ID, "Working", "working", false)
	reviewID := insertLifecycleTask(t, ctx, db, boardID, bucketID, agent.ID, "Review", "needs_review", false)
	doneID := insertLifecycleTask(t, ctx, db, boardID, bucketID, agent.ID, "Done", "done", true)

	var agentUpdatedBefore, readyUpdatedBefore, workingUpdatedBefore time.Time
	if err := db.QueryRow(ctx, "SELECT updated_at FROM agents WHERE id = $1", agent.ID).Scan(&agentUpdatedBefore); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, "SELECT updated_at FROM tasks WHERE id = $1", readyID).Scan(&readyUpdatedBefore); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, "SELECT updated_at FROM tasks WHERE id = $1", workingID).Scan(&workingUpdatedBefore); err != nil {
		t.Fatal(err)
	}
	counts, err := store.ArchiveAgent(ctx, owner.ID, agent.ID, false)
	if !errors.Is(err, ErrArchiveConflict) || counts != (ArchiveConflict{Ready: 1, Working: 1}) {
		t.Fatalf("archive conflict = %#v, error = %v", counts, err)
	}
	assertLifecycleTask(t, ctx, db, readyID, agent.ID, "queued", false)
	assertLifecycleTask(t, ctx, db, workingID, agent.ID, "working", false)
	var agentUpdatedAfter, readyUpdatedAfter, workingUpdatedAfter time.Time
	if err := db.QueryRow(ctx, "SELECT updated_at FROM agents WHERE id = $1", agent.ID).Scan(&agentUpdatedAfter); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, "SELECT updated_at FROM tasks WHERE id = $1", readyID).Scan(&readyUpdatedAfter); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, "SELECT updated_at FROM tasks WHERE id = $1", workingID).Scan(&workingUpdatedAfter); err != nil {
		t.Fatal(err)
	}
	if !agentUpdatedAfter.Equal(agentUpdatedBefore) || !readyUpdatedAfter.Equal(readyUpdatedBefore) || !workingUpdatedAfter.Equal(workingUpdatedBefore) {
		t.Fatal("archive conflict changed agent or task metadata")
	}
	if _, err := authStore.FindUserByAPITokenHash(ctx, lifecycleHash(preArchiveToken), time.Now()); err != nil {
		t.Fatalf("archive conflict revoked credential: %v", err)
	}
	stillActive, err := authStore.GetAgent(ctx, owner.ID, agent.ID)
	if err != nil || stillActive.ArchivedAt != nil {
		t.Fatalf("conflicted archive changed agent = %#v, error = %v", stillActive, err)
	}

	if _, err := db.Exec(ctx, `
		CREATE OR REPLACE FUNCTION slate_test_reject_agent_archive() RETURNS trigger AS $$
		BEGIN
			IF NEW.name = 'Builder Prime' AND OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
				RAISE EXCEPTION 'injected archive failure';
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;
		CREATE TRIGGER slate_test_reject_agent_archive
		BEFORE UPDATE ON agents
		FOR EACH ROW EXECUTE FUNCTION slate_test_reject_agent_archive();
	`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DROP TRIGGER IF EXISTS slate_test_reject_agent_archive ON agents")
		_, _ = db.Exec(context.Background(), "DROP FUNCTION IF EXISTS slate_test_reject_agent_archive()")
	})
	if _, err := store.ArchiveAgent(ctx, owner.ID, agent.ID, true); err == nil {
		t.Fatal("forced archive succeeded despite injected final update failure")
	}
	assertLifecycleTask(t, ctx, db, readyID, agent.ID, "queued", false)
	assertLifecycleTask(t, ctx, db, workingID, agent.ID, "working", false)
	if _, err := authStore.FindUserByAPITokenHash(ctx, lifecycleHash(preArchiveToken), time.Now()); err != nil {
		t.Fatalf("failed archive did not roll back credential revocation: %v", err)
	}
	if failedArchive, err := authStore.GetAgent(ctx, owner.ID, agent.ID); err != nil || failedArchive.ArchivedAt != nil {
		t.Fatalf("failed archive changed identity = %#v, error = %v", failedArchive, err)
	}
	if _, err := db.Exec(ctx, `
		DROP TRIGGER slate_test_reject_agent_archive ON agents;
		DROP FUNCTION slate_test_reject_agent_archive();
	`); err != nil {
		t.Fatal(err)
	}

	counts, err = store.ArchiveAgent(ctx, owner.ID, agent.ID, true)
	if err != nil || counts != (ArchiveConflict{Ready: 1, Working: 1}) {
		t.Fatalf("forced archive = %#v, error = %v", counts, err)
	}
	assertLifecycleTask(t, ctx, db, readyID, "", "queued", false)
	assertLifecycleTask(t, ctx, db, workingID, "", "queued", false)
	assertLifecycleTask(t, ctx, db, reviewID, agent.ID, "needs_review", false)
	assertLifecycleTask(t, ctx, db, doneID, agent.ID, "done", true)
	archived, err := authStore.GetAgent(ctx, owner.ID, agent.ID)
	if err != nil || archived.ArchivedAt == nil || archived.Credential == nil || archived.Credential.RevokedAt == nil {
		t.Fatalf("archived agent = %#v, error = %v", archived, err)
	}
	if _, err := authStore.FindUserByAPITokenHash(ctx, lifecycleHash(preArchiveToken), time.Now()); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatalf("archived credential still authenticates: %v", err)
	}
	queued := boards.StatusQueued
	if _, err := boards.NewStore(db).UpdateTask(ctx, owner.ID, reviewID, boards.UpdateTaskInput{Status: &queued}); !errors.Is(err, boards.ErrInvalidData) {
		t.Fatalf("archived Review item returned to Ready without reassignment error = %v", err)
	}
	unassigned := ""
	if updated, err := boards.NewStore(db).UpdateTask(ctx, owner.ID, reviewID, boards.UpdateTaskInput{Status: &queued, AssigneeAgentID: &unassigned}); err != nil || updated.AssigneeAgentID != "" {
		t.Fatalf("clear archived Review assignment = %#v, error = %v", updated, err)
	}
	if _, _, err := store.RotateCredential(ctx, owner.ID, agent.ID, "rotation-key-0000000000000003", lifecycleHash("archived"), "archived"); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("archived rotation error = %v", err)
	}
	replayedAfterArchive, applied, err := store.RotateCredential(ctx, owner.ID, agent.ID, "rotation-key-0000000000000001", lifecycleHash("unused"), "unused")
	if err != nil || applied || replayedAfterArchive.ID != credential.ID {
		t.Fatalf("archived replay = %#v, applied = %t, error = %v", replayedAfterArchive, applied, err)
	}
	if _, err := store.ArchiveAgent(ctx, owner.ID, agent.ID, false); err != nil {
		t.Fatalf("idempotent archive: %v", err)
	}

	// Fill all five active slots. The archived identity does not consume one.
	var limitAgents []auth.AgentUser
	for index := 0; index < 4; index++ {
		limitAgent, err := authStore.CreateAgent(ctx, owner.ID, fmt.Sprintf("Limit %d", index), "", lifecycleHash(fmt.Sprintf("limit-%d-%d", stamp, index)), fmt.Sprintf("slate_agent_limit_%d", index))
		if err != nil {
			t.Fatal(err)
		}
		limitAgents = append(limitAgents, limitAgent)
	}
	if _, err := store.RestoreAgent(ctx, owner.ID, agent.ID); !errors.Is(err, ErrRestoreLimit) {
		t.Fatalf("restore over limit error = %v", err)
	}
	if _, err := store.ArchiveAgent(ctx, owner.ID, duplicate.ID, false); err != nil {
		t.Fatal(err)
	}
	nameConflict, err := authStore.CreateAgent(ctx, owner.ID, "Builder Prime", "", lifecycleHash("name-conflict"), "slate_agent_name")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ArchiveAgent(ctx, owner.ID, limitAgents[0].ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RestoreAgent(ctx, owner.ID, agent.ID); !errors.Is(err, ErrRestoreNameTaken) {
		t.Fatalf("restore name conflict error = %v", err)
	}
	if _, err := store.ArchiveAgent(ctx, owner.ID, nameConflict.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateAgent(ctx, owner.ID, agent.ID, "Restored Builder", "Historical identity"); err != nil {
		t.Fatal(err)
	}
	restored, err := store.RestoreAgent(ctx, owner.ID, agent.ID)
	if err != nil || restored.ArchivedAt != nil || restored.Credential == nil || restored.Credential.RevokedAt == nil {
		t.Fatalf("restored identity = %#v, error = %v", restored, err)
	}
}

func TestDeleteAgentRequiresArchiveAndRemovesOwnedIdentity(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run agent deletion integration tests")
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
	authStore := auth.NewPGStore(db)
	store := NewStore(db, authStore)
	stamp := time.Now().UnixNano()
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-delete-owner-%d@slate.test", stamp), "hash")
	if err != nil {
		t.Fatal(err)
	}
	otherOwner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-delete-other-%d@slate.test", stamp), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1 OR id = $2", owner.ID, otherOwner.ID)
	})
	agent, err := authStore.CreateAgent(ctx, owner.ID, "Delete candidate", "Historical work", lifecycleHash("delete-candidate"), "delete-candidate")
	if err != nil {
		t.Fatal(err)
	}
	foreignAgent, err := authStore.CreateAgent(ctx, otherOwner.ID, "Other owner agent", "", lifecycleHash("other-owner-agent"), "other-owner")
	if err != nil {
		t.Fatal(err)
	}
	boardID, bucketID := insertBoardAndBucket(t, ctx, db, owner.ID, "Deletion board")
	taskID := insertLifecycleTask(t, ctx, db, boardID, bucketID, agent.ID, "Historical assignment", "done", true)

	if err := store.DeleteAgent(ctx, owner.ID, agent.ID); !errors.Is(err, ErrDeleteRequiresArchive) {
		t.Fatalf("active delete error = %v", err)
	}
	assertLifecycleTask(t, ctx, db, taskID, agent.ID, "done", true)
	if err := store.DeleteAgent(ctx, owner.ID, foreignAgent.ID); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("cross-owner delete error = %v", err)
	}
	if _, err := store.ArchiveAgent(ctx, owner.ID, agent.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteAgent(ctx, owner.ID, agent.ID); err != nil {
		t.Fatal(err)
	}

	var agents, credentials int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM agents WHERE id = $1", agent.ID).Scan(&agents); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, "SELECT count(*) FROM agent_credentials WHERE agent_id = $1", agent.ID).Scan(&credentials); err != nil {
		t.Fatal(err)
	}
	if agents != 0 || credentials != 0 {
		t.Fatalf("deleted rows = agents %d, credentials %d", agents, credentials)
	}
	assertLifecycleTask(t, ctx, db, taskID, "", "done", true)
	if err := store.DeleteAgent(ctx, owner.ID, agent.ID); !errors.Is(err, auth.ErrAgentNotFound) {
		t.Fatalf("repeated delete error = %v", err)
	}
}

func TestConcurrentRotationAndAssignmentArchiveKeepLifecycleInvariants(t *testing.T) {
	databaseURL := os.Getenv("SLATE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run lifecycle concurrency tests")
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
	authStore := auth.NewPGStore(db)
	store := NewStore(db, authStore)
	boardStore := boards.NewStore(db)
	stamp := time.Now().UnixNano()
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-concurrency-owner-%d@slate.test", stamp), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", owner.ID) })
	agent, err := authStore.CreateAgent(ctx, owner.ID, "Concurrent", "", lifecycleHash("initial"), "initial")
	if err != nil {
		t.Fatal(err)
	}

	type rotationResult struct {
		credential auth.AgentCredential
		applied    bool
		err        error
	}
	start := make(chan struct{})
	results := make(chan rotationResult, 2)
	for index := range 2 {
		go func(index int) {
			<-start
			credential, applied, err := store.RotateCredential(
				ctx, owner.ID, agent.ID, "concurrent-rotation-key-0001",
				lifecycleHash(fmt.Sprintf("candidate-%d", index)), fmt.Sprintf("candidate-%d", index),
			)
			results <- rotationResult{credential: credential, applied: applied, err: err}
		}(index)
	}
	close(start)
	first, second := <-results, <-results
	if first.err != nil || second.err != nil || first.credential.ID != second.credential.ID || first.applied == second.applied {
		t.Fatalf("concurrent rotations = %#v / %#v", first, second)
	}
	var activeCredentials int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM agent_credentials WHERE agent_id = $1 AND revoked_at IS NULL", agent.ID).Scan(&activeCredentials); err != nil {
		t.Fatal(err)
	}
	if activeCredentials != 1 {
		t.Fatalf("active credentials = %d, want 1", activeCredentials)
	}

	boardID, bucketID := insertBoardAndBucket(t, ctx, db, owner.ID, "Race board")
	var taskID string
	if err := db.QueryRow(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, kind, status, done)
		VALUES ($1, $2, 'Race assignment', 'action', 'queued', false)
		RETURNING id::text
	`, boardID, bucketID).Scan(&taskID); err != nil {
		t.Fatal(err)
	}
	assignment := agent.ID
	start = make(chan struct{})
	var assignmentErr, archiveErr error
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		<-start
		_, assignmentErr = boardStore.UpdateTask(ctx, owner.ID, taskID, boards.UpdateTaskInput{AssigneeAgentID: &assignment})
	}()
	go func() {
		defer wait.Done()
		<-start
		_, archiveErr = store.ArchiveAgent(ctx, owner.ID, agent.ID, false)
	}()
	close(start)
	wait.Wait()
	if assignmentErr != nil && archiveErr != nil {
		t.Fatalf("both assignment and archive failed: assignment %v, archive %v", assignmentErr, archiveErr)
	}
	var archived bool
	var assignedAgentID, status string
	if err := db.QueryRow(ctx, `
		SELECT a.archived_at IS NOT NULL, COALESCE(t.assignee_agent_id::text, ''), t.status
		FROM agents a CROSS JOIN tasks t
		WHERE a.id = $1 AND t.id = $2
	`, agent.ID, taskID).Scan(&archived, &assignedAgentID, &status); err != nil {
		t.Fatal(err)
	}
	if archived && assignedAgentID == agent.ID && (status == "queued" || status == "working") {
		t.Fatalf("archive stranded open assignment: archived=%t agent=%q status=%q", archived, assignedAgentID, status)
	}

	restoreOwner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("agent-restore-race-%d@slate.test", stamp), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", restoreOwner.ID) })
	archivedAgent, err := authStore.CreateAgent(ctx, restoreOwner.ID, "Restore candidate", "", lifecycleHash("restore-candidate"), "restore")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ArchiveAgent(ctx, restoreOwner.ID, archivedAgent.ID, false); err != nil {
		t.Fatal(err)
	}
	for index := range 4 {
		if _, err := authStore.CreateAgent(ctx, restoreOwner.ID, fmt.Sprintf("Existing %d", index), "", lifecycleHash(fmt.Sprintf("existing-%d", index)), fmt.Sprintf("existing-%d", index)); err != nil {
			t.Fatal(err)
		}
	}
	start = make(chan struct{})
	var restoreErr, createErr error
	wait.Add(2)
	go func() {
		defer wait.Done()
		<-start
		_, restoreErr = store.RestoreAgent(ctx, restoreOwner.ID, archivedAgent.ID)
	}()
	go func() {
		defer wait.Done()
		<-start
		_, createErr = authStore.CreateAgent(ctx, restoreOwner.ID, "Concurrent fifth", "", lifecycleHash("concurrent-fifth"), "fifth")
	}()
	close(start)
	wait.Wait()
	if (restoreErr == nil) == (createErr == nil) {
		t.Fatalf("restore/create outcomes = restore %v, create %v; want exactly one success", restoreErr, createErr)
	}
	if restoreErr != nil && !errors.Is(restoreErr, ErrRestoreLimit) {
		t.Fatalf("restore race error = %v", restoreErr)
	}
	if createErr != nil && !errors.Is(createErr, auth.ErrAgentLimit) {
		t.Fatalf("create race error = %v", createErr)
	}
	var activeAgents int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM agents WHERE owner_user_id = $1 AND archived_at IS NULL", restoreOwner.ID).Scan(&activeAgents); err != nil {
		t.Fatal(err)
	}
	if activeAgents != 5 {
		t.Fatalf("active agents after restore/create race = %d, want 5", activeAgents)
	}
}

func lifecycleHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", sum[:])
}

func insertLifecycleTask(t *testing.T, ctx context.Context, db *database.Pool, boardID, bucketID, agentID, title, status string, done bool) string {
	t.Helper()
	var id string
	if err := db.QueryRow(ctx, `
		INSERT INTO tasks (board_id, bucket_id, title, kind, status, done, assignee_agent_id)
		VALUES ($1, $2, $3, 'action', $4, $5, $6)
		RETURNING id::text
	`, boardID, bucketID, title, status, done, agentID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func assertLifecycleTask(t *testing.T, ctx context.Context, db *database.Pool, taskID, agentID, status string, done bool) {
	t.Helper()
	var gotAgentID, gotStatus string
	var gotDone bool
	if err := db.QueryRow(ctx, `
		SELECT COALESCE(assignee_agent_id::text, ''), status, done
		FROM tasks WHERE id = $1
	`, taskID).Scan(&gotAgentID, &gotStatus, &gotDone); err != nil {
		t.Fatal(err)
	}
	if gotAgentID != agentID || gotStatus != status || gotDone != done {
		t.Fatalf("task %s = agent %q, status %q, done %t; want %q, %q, %t", taskID, gotAgentID, gotStatus, gotDone, agentID, status, done)
	}
}

func insertBoardAndBucket(t *testing.T, ctx context.Context, db *database.Pool, userID string, name string) (string, string) {
	t.Helper()
	var boardID, bucketID string
	if err := db.QueryRow(ctx, `
		INSERT INTO boards (user_id, name, max_tasks_per_list)
		VALUES ($1, $2, 20)
		RETURNING id::text
	`, userID, name).Scan(&boardID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `
		INSERT INTO buckets (board_id, name, limit_count)
		VALUES ($1, 'Inbox', 20)
		RETURNING id::text
	`, boardID).Scan(&bucketID); err != nil {
		t.Fatal(err)
	}
	return boardID, bucketID
}

func insertAssignedTask(t *testing.T, ctx context.Context, db *database.Pool, boardID string, bucketID string, agentID string, title string, status string, done bool, updatedAt time.Time) {
	t.Helper()
	if _, err := db.Exec(ctx, `
		INSERT INTO tasks (
			board_id, bucket_id, title, kind, done, status, assignee_agent_id,
			sort_order, created_at, updated_at
		)
		VALUES ($1, $2, $3, 'action', $4, $5, $6, 0, $7, $7)
	`, boardID, bucketID, title, done, status, agentID, updatedAt); err != nil {
		t.Fatal(err)
	}
}
