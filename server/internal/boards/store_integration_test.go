package boards

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/owainlewis/slate.do/server/internal/database"
	"github.com/owainlewis/slate.do/server/internal/migrations"
)

func TestBoardMaxTasksPerListAppliesToAllBuckets(t *testing.T) {
	db := openIntegrationDB(t)
	ctx := context.Background()
	store := NewStore(db)
	userID := createIntegrationUser(t, ctx, db)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	board, err := store.CreateBoard(ctx, userID, CreateBoardInput{Name: "Limits", MaxTasksPerList: 2})
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "First", LimitCount: 99})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.CreateBucket(ctx, userID, board.ID, CreateBucketInput{Name: "Second", LimitCount: 1})
	if err != nil {
		t.Fatal(err)
	}

	for i := 1; i <= 2; i++ {
		if _, err := store.CreateTask(ctx, userID, first.ID, CreateTaskInput{Title: fmt.Sprintf("first %d", i)}); err != nil {
			t.Fatal(err)
		}
		if _, err := store.CreateTask(ctx, userID, second.ID, CreateTaskInput{Title: fmt.Sprintf("second %d", i)}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.CreateTask(ctx, userID, first.ID, CreateTaskInput{Title: "too many"}); !errors.Is(err, ErrLimitFull) {
		t.Fatalf("first list error = %v, want ErrLimitFull", err)
	}
	if _, err := store.CreateTask(ctx, userID, second.ID, CreateTaskInput{Title: "too many"}); !errors.Is(err, ErrLimitFull) {
		t.Fatalf("second list error = %v, want ErrLimitFull", err)
	}

	next := 3
	if _, err := store.UpdateBoard(ctx, userID, board.ID, UpdateBoardInput{MaxTasksPerList: &next}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateTask(ctx, userID, first.ID, CreateTaskInput{Title: "now allowed"}); err != nil {
		t.Fatal(err)
	}
}

func openIntegrationDB(t *testing.T) *database.Pool {
	t.Helper()
	url := os.Getenv("SLATE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set SLATE_TEST_DATABASE_URL to run board store integration tests")
	}
	db, err := database.Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := migrations.Apply(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	return db
}

func createIntegrationUser(t *testing.T, ctx context.Context, db *database.Pool) string {
	t.Helper()
	email := fmt.Sprintf("%s-%d@slate.test", strings.ToLower(t.Name()), time.Now().UnixNano())
	var id string
	if err := db.QueryRow(ctx, `
		INSERT INTO users (email, password_hash)
		VALUES ($1, 'test')
		RETURNING id::text
	`, email).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
