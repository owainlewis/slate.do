package boards

import (
	"errors"
	"net/http/httptest"
	"testing"
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

func TestTaskFilterFromQueryIncludesPriority(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/v1/tasks?priority=p0", nil)
	filter, err := taskFilterFromQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if filter.Priority != PriorityP0 {
		t.Fatalf("filter.Priority = %q", filter.Priority)
	}
}

func TestTaskFilterFromQueryIncludesBoardAndList(t *testing.T) {
	const boardID = "11111111-1111-4111-8111-111111111111"
	const bucketID = "22222222-2222-4222-8222-222222222222"
	req := httptest.NewRequest("GET", "/api/v1/tasks?boardId="+boardID+"&bucketId="+bucketID+"&status=done&limit=12&cursor=next-page", nil)
	filter, err := taskFilterFromQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if filter.BoardID != boardID || filter.BucketID != bucketID || filter.Status != "done" || filter.Limit != 12 || filter.Cursor != "next-page" {
		t.Fatalf("filter = %#v", filter)
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
	for _, query := range []string{"boardId=not-an-id", "bucketId=not-an-id", "assigneeAgentId=not-an-id", "parentTaskId=not-an-id", "plannedFrom=tomorrow", "plannedTo=2026-13-01", "topLevel=maybe", "inbox=maybe"} {
		req := httptest.NewRequest("GET", "/api/v1/tasks?"+query, nil)
		if _, err := taskFilterFromQuery(req); err == nil {
			t.Fatalf("query %q was accepted", query)
		}
	}
}

func TestTaskPageRejectsMalformedLocationIDsBeforeDatabaseAccess(t *testing.T) {
	store := NewStore(nil)
	for _, filter := range []TaskFilter{{BoardID: "not-an-id"}, {BucketID: "not-an-id"}} {
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
