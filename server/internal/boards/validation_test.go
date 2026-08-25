package boards

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"
	"time"
)

func TestValidStatus(t *testing.T) {
	for _, status := range []string{StatusNew, StatusQueued, StatusWorking, StatusNeedsReview, StatusDone} {
		if !validStatus(status) {
			t.Fatalf("%s should be valid", status)
		}
	}
	if validStatus("blocked") {
		t.Fatal("blocked should not be valid in MVP")
	}
}

func TestApplyTaskStatusAllowsEveryHumanTransition(t *testing.T) {
	for _, status := range []string{StatusNew, StatusQueued, StatusWorking, StatusNeedsReview, StatusDone} {
		task := Task{Kind: KindAction, Status: StatusQueued}
		if err := applyTaskStatus(&task, status, true); err != nil {
			t.Fatalf("apply %q: %v", status, err)
		}
		if task.Status != status {
			t.Fatalf("status = %q, want %q", task.Status, status)
		}
	}
}

func TestApplyTaskStatusPreservesAgentClaimContract(t *testing.T) {
	task := Task{Kind: KindAction, Status: StatusQueued}
	if err := applyTaskStatus(&task, StatusWorking, false); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("working without claim error = %v, want ErrInvalidData", err)
	}
	if task.Status != StatusQueued {
		t.Fatalf("status changed to %q", task.Status)
	}
}

func TestApplyTaskStatusRejectsLegacyItems(t *testing.T) {
	task := Task{Kind: "item", Status: StatusQueued}
	if err := applyTaskStatus(&task, StatusDone, true); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("item status error = %v, want ErrInvalidData", err)
	}
}

func TestValidDate(t *testing.T) {
	for _, value := range []string{"", "2026-07-13"} {
		if got, err := validDate(value); err != nil || got != value {
			t.Fatalf("validDate(%q) = %q, %v", value, got, err)
		}
	}
	if _, err := validDate("13/07/2026"); err == nil {
		t.Fatal("expected invalid date error")
	}
}

func TestValidKind(t *testing.T) {
	if !validKind(KindAction) {
		t.Fatal("action should be a valid kind")
	}
	if validKind("item") || validKind("task") {
		t.Fatal("unexpected valid kind")
	}
}

func TestPrepareTaskCreateRejectsMalformedParentID(t *testing.T) {
	_, err := prepareTaskCreate(CreateTaskInput{Title: "Child", ParentTaskID: "not-a-uuid"}, "inbox")
	if !errors.Is(err, ErrInvalidData) {
		t.Fatalf("error = %v, want ErrInvalidData", err)
	}
}

func TestValidPriority(t *testing.T) {
	for _, priority := range []string{PriorityNone, PriorityP0, PriorityP1, PriorityP2} {
		if !validPriority(priority) {
			t.Fatalf("%q should be valid", priority)
		}
	}
	if validPriority("p3") || validPriority("P0") || validPriority("urgent") {
		t.Fatal("unexpected valid priority")
	}
}

func TestValidListColor(t *testing.T) {
	for _, color := range []string{ListColorSlate, ListColorRed, ListColorOrange, ListColorYellow, ListColorGreen, ListColorTeal, ListColorBlue, ListColorIndigo, ListColorPurple, ListColorPink} {
		if !validListColor(color) {
			t.Fatalf("%q should be valid", color)
		}
	}
	if validListColor("") || validListColor("Blue") || validListColor("#ffffff") {
		t.Fatal("unexpected valid list color")
	}
}

func TestTaskFilterFromQueryIncludesPriority(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/v1/tasks?priority=p0&sort=list_priority", nil)
	filter, err := taskFilterFromQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if filter.Priority != PriorityP0 || filter.Sort != "list_priority" {
		t.Fatalf("filter = %#v", filter)
	}
}

func TestTaskFilterFromQueryIncludesList(t *testing.T) {
	const bucketID = "22222222-2222-4222-8222-222222222222"
	req := httptest.NewRequest("GET", "/api/v1/tasks?bucketId="+bucketID+"&status=done&limit=12&cursor=next-page", nil)
	filter, err := taskFilterFromQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if filter.BucketID != bucketID || filter.Status != "done" || filter.Limit != 12 || filter.Cursor != "next-page" {
		t.Fatalf("filter = %#v", filter)
	}
}

func TestTaskFilterFromQueryMapsLegacyDone(t *testing.T) {
	doneRequest := httptest.NewRequest("GET", "/api/v1/tasks?done=true", nil)
	doneFilter, err := taskFilterFromQuery(doneRequest)
	if err != nil {
		t.Fatal(err)
	}
	if doneFilter.Status != StatusDone || doneFilter.Done == nil || !*doneFilter.Done {
		t.Fatalf("done filter = %#v", doneFilter)
	}

	openRequest := httptest.NewRequest("GET", "/api/v1/tasks?done=false", nil)
	openFilter, err := taskFilterFromQuery(openRequest)
	if err != nil {
		t.Fatal(err)
	}
	if openFilter.Status != "" || openFilter.Done == nil || *openFilter.Done {
		t.Fatalf("open filter = %#v", openFilter)
	}
	mixedRequest := httptest.NewRequest("GET", "/api/v1/tasks?status=working&done=true", nil)
	mixedFilter, err := taskFilterFromQuery(mixedRequest)
	if err != nil {
		t.Fatal(err)
	}
	if mixedFilter.Status != StatusWorking || mixedFilter.Done == nil || !*mixedFilter.Done {
		t.Fatalf("mixed filter = %#v", mixedFilter)
	}

	invalidRequest := httptest.NewRequest("GET", "/api/v1/tasks?done=maybe", nil)
	if _, err := taskFilterFromQuery(invalidRequest); err == nil {
		t.Fatal("invalid legacy done filter was accepted")
	}

	statusScope := taskCursorScope("user-one", TaskFilter{Status: StatusDone})
	if legacyScope := taskCursorScope("user-one", doneFilter); legacyScope != statusScope {
		t.Fatalf("done=true scope = %q, want status=done scope %q", legacyScope, statusScope)
	}
	if mixedScope := taskCursorScope("user-one", mixedFilter); mixedScope == taskCursorScope("user-one", TaskFilter{Status: StatusWorking}) {
		t.Fatal("mixed legacy filter reused the status-only cursor scope")
	}
}

func TestTaskFilterFromQueryIncludesWorkspaceFilters(t *testing.T) {
	const id = "11111111-1111-4111-8111-111111111111"
	req := httptest.NewRequest("GET", "/api/v1/tasks?q=video&assigneeAgentId=unassigned&plannedFrom=2026-08-01&plannedTo=2026-08-31&parentTaskId="+id+"&topLevel=true&inbox=true", nil)
	filter, err := taskFilterFromQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if filter.Query != "video" || !filter.Unassigned || filter.ScheduledFrom != "2026-08-01" || filter.ScheduledTo != "2026-08-31" || filter.ParentTaskID != id || !filter.TopLevelOnly || !filter.InboxOnly {
		t.Fatalf("filter = %#v", filter)
	}
}

func TestTaskFilterRejectsInvalidWorkspaceFilters(t *testing.T) {
	for _, query := range []string{"bucketId=not-an-id", "assigneeAgentId=not-an-id", "parentTaskId=not-an-id", "plannedFrom=tomorrow", "plannedTo=2026-13-01", "topLevel=maybe", "inbox=maybe", "sort=title"} {
		req := httptest.NewRequest("GET", "/api/v1/tasks?"+query, nil)
		if _, err := taskFilterFromQuery(req); err == nil {
			t.Fatalf("query %q was accepted", query)
		}
	}
}

func TestTaskPageRejectsMalformedLocationIDsBeforeDatabaseAccess(t *testing.T) {
	store := NewStore(nil)
	for _, filter := range []TaskFilter{{BucketID: "not-an-id"}} {
		if _, err := store.ListTaskPage(t.Context(), "user", filter); !errors.Is(err, ErrInvalidData) {
			t.Fatalf("filter %#v error = %v, want ErrInvalidData", filter, err)
		}
	}
}

func TestTaskFilterRejectsInvalidLimit(t *testing.T) {
	for _, raw := range []string{"0", "-1", "many"} {
		req := httptest.NewRequest("GET", "/api/v1/tasks?limit="+raw, nil)
		if _, err := taskFilterFromQuery(req); err == nil {
			t.Fatalf("limit %q was accepted", raw)
		}
	}
}

func TestWorkspaceTaskCursorRejectsSortOrderOutsidePostgresIntegerRange(t *testing.T) {
	const scope = "workspace-sort"
	for _, sortOrder := range []int{minPostgresInteger - 1, maxPostgresInteger + 1} {
		raw, err := json.Marshal(workspaceTaskCursor{
			BucketSortOrder: sortOrder,
			BucketCreatedAt: time.Now().UTC(),
			BucketID:        "11111111-1111-4111-8111-111111111111",
			CreatedAt:       time.Now().UTC(),
			ID:              "22222222-2222-4222-8222-222222222222",
			Scope:           scope,
		})
		if err != nil {
			t.Fatal(err)
		}
		cursor := base64.RawURLEncoding.EncodeToString(raw)
		if _, err := decodeWorkspaceTaskCursor(cursor, scope, "list"); !errors.Is(err, ErrInvalidData) {
			t.Fatalf("sort order %d error = %v, want ErrInvalidData", sortOrder, err)
		}
	}
}
