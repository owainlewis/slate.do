package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/boards"
)

func TestInboxCaptureRepairsAnAccountWithoutBoardsOrLists(t *testing.T) {
	db := openServerIntegrationDB(t)
	ctx := context.Background()
	authStore := auth.NewPGStore(db)
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("empty-capture-%d@slate.test", time.Now().UnixNano()), "hash")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM users WHERE id = $1", owner.ID) })
	token := fmt.Sprintf("slate_empty_capture_%d", time.Now().UnixNano())
	if _, err := authStore.CreateAPIToken(ctx, owner.ID, "empty capture", testTokenHash(token)); err != nil {
		t.Fatal(err)
	}

	handler := NewApp(fstest.MapFS{"index.html": {Data: []byte("app")}}, db, false, auth.Options{}).Routes()
	firstResponse := agentRequest(t, handler, token, http.MethodPost, "/api/v1/tasks", `{"title":"First captured task"}`)
	if firstResponse.Code != http.StatusCreated {
		t.Fatalf("first capture = %d %s", firstResponse.Code, firstResponse.Body.String())
	}
	var first boards.Task
	if err := json.Unmarshal(firstResponse.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}

	secondResponse := agentRequest(t, handler, token, http.MethodPost, "/api/v1/tasks", `{"title":"Second captured task"}`)
	if secondResponse.Code != http.StatusCreated {
		t.Fatalf("second capture = %d %s", secondResponse.Code, secondResponse.Body.String())
	}
	var second boards.Task
	if err := json.Unmarshal(secondResponse.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}

	store := boards.NewStore(db)
	accountBoards, err := store.ListBoards(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	lists, err := store.ListAllBuckets(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(accountBoards) != 1 || len(lists) != 1 || !lists[0].IsInbox || first.BucketID != lists[0].ID || second.BucketID != lists[0].ID {
		t.Fatalf("boards = %#v, lists = %#v, first = %#v, second = %#v", accountBoards, lists, first, second)
	}
}
