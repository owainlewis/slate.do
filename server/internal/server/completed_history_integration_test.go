package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/owainlewis/slate.do/server/internal/auth"
	"github.com/owainlewis/slate.do/server/internal/boards"
)

func TestBoardAPIUsesSummaryCollectionsAndExactTaskDetail(t *testing.T) {
	db := openServerIntegrationDB(t)
	ctx := context.Background()
	authStore := auth.NewPGStore(db)
	owner, err := authStore.CreateAdmin(ctx, fmt.Sprintf("history-api-%d@slate.test", time.Now().UnixNano()), "hash")
	if err != nil {
		t.Fatal(err)
	}
	token := fmt.Sprintf("slate_history_%d", time.Now().UnixNano())
	if _, err := authStore.CreateAPIToken(ctx, owner.ID, "history", testTokenHash(token)); err != nil {
		t.Fatal(err)
	}
	store := boards.NewStore(db)
	board, err := store.CreateBoard(ctx, owner.ID, boards.CreateBoardInput{Name: "History API"})
	if err != nil {
		t.Fatal(err)
	}
	bucket, err := store.CreateBucket(ctx, owner.ID, board.ID, boards.CreateBucketInput{Name: "Done"})
	if err != nil {
		t.Fatal(err)
	}
	done := boards.StatusDone
	var exactID string
	for index := 0; index < 21; index++ {
		task, err := store.CreateTask(ctx, owner.ID, bucket.ID, boards.CreateTaskInput{
			Title:       fmt.Sprintf("Completed %02d", index),
			Description: fmt.Sprintf("private detail %02d", index),
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.UpdateTask(ctx, owner.ID, task.ID, boards.UpdateTaskInput{Status: &done}); err != nil {
			t.Fatal(err)
		}
		exactID = task.ID
	}
	if _, err := store.CreateTask(ctx, owner.ID, bucket.ID, boards.CreateTaskInput{Title: "Active", Description: "active private detail"}); err != nil {
		t.Fatal(err)
	}

	handler := NewApp(fstest.MapFS{"index.html": {Data: []byte("app")}}, db, false, auth.Options{}).Routes()
	boardResponse := agentRequest(t, handler, token, http.MethodGet, "/api/v1/boards/"+board.ID, "")
	if boardResponse.Code != http.StatusOK || strings.Contains(boardResponse.Body.String(), "description") || strings.Contains(boardResponse.Body.String(), "private detail") {
		t.Fatalf("board summary response = %d %s", boardResponse.Code, boardResponse.Body.String())
	}
	var loaded boards.Board
	if err := json.Unmarshal(boardResponse.Body.Bytes(), &loaded); err != nil {
		t.Fatal(err)
	}
	if len(loaded.Buckets) != 1 || len(loaded.Buckets[0].Tasks) != 21 || loaded.Buckets[0].CompletedNextCursor == "" {
		t.Fatalf("bounded board response = %#v", loaded.Buckets)
	}

	detailResponse := agentRequest(t, handler, token, http.MethodGet, "/api/v1/tasks/"+exactID, "")
	if detailResponse.Code != http.StatusOK || !strings.Contains(detailResponse.Body.String(), "private detail 20") {
		t.Fatalf("exact task response = %d %s", detailResponse.Code, detailResponse.Body.String())
	}
	pageResponse := agentRequest(t, handler, token, http.MethodGet, "/api/v1/tasks?bucketId="+bucket.ID+"&status=done", "")
	if pageResponse.Code != http.StatusOK || strings.Contains(pageResponse.Body.String(), "description") {
		t.Fatalf("history page response = %d %s", pageResponse.Code, pageResponse.Body.String())
	}
	var page boards.TaskPage
	if err := json.Unmarshal(pageResponse.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Tasks) != 20 || page.NextCursor == "" {
		t.Fatalf("history page = %#v", page)
	}
	continuation := agentRequest(t, handler, token, http.MethodGet, "/api/v1/tasks?bucketId="+bucket.ID+"&status=done&cursor="+page.NextCursor, "")
	if continuation.Code != http.StatusOK {
		t.Fatalf("history continuation = %d %s", continuation.Code, continuation.Body.String())
	}
	var finalPage boards.TaskPage
	if err := json.Unmarshal(continuation.Body.Bytes(), &finalPage); err != nil {
		t.Fatal(err)
	}
	if len(finalPage.Tasks) != 1 || finalPage.NextCursor != "" {
		t.Fatalf("final history page = %#v", finalPage)
	}
	badCursor := agentRequest(t, handler, token, http.MethodGet, "/api/v1/tasks?status=done&cursor=invalid", "")
	if badCursor.Code != http.StatusBadRequest {
		t.Fatalf("bad cursor response = %d %s", badCursor.Code, badCursor.Body.String())
	}
	malformedUUIDCursor := cursorWithID(t, page.NextCursor, "--------------------------------0123456789abcdef0123456789abcdef")
	badUUID := agentRequest(t, handler, token, http.MethodGet, "/api/v1/tasks?bucketId="+bucket.ID+"&status=done&cursor="+malformedUUIDCursor, "")
	if badUUID.Code != http.StatusBadRequest {
		t.Fatalf("malformed cursor UUID response = %d %s", badUUID.Code, badUUID.Body.String())
	}
}

func cursorWithID(t *testing.T, raw, id string) string {
	t.Helper()
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		t.Fatal(err)
	}
	var cursor map[string]any
	if err := json.Unmarshal(decoded, &cursor); err != nil {
		t.Fatal(err)
	}
	cursor["id"] = id
	encoded, err := json.Marshal(cursor)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(encoded)
}
