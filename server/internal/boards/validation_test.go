package boards

import (
	"errors"
	"net/http/httptest"
	"testing"
)

func TestValidStatus(t *testing.T) {
	for _, status := range []string{StatusQueued, StatusWorking, StatusNeedsReview, StatusDone} {
		if !validStatus(status) {
			t.Fatalf("%s should be valid", status)
		}
	}
	if validStatus("blocked") {
		t.Fatal("blocked should not be valid in MVP")
	}
}

func TestApplyTaskStatusAllowsEveryHumanTransition(t *testing.T) {
	for _, status := range []string{StatusQueued, StatusWorking, StatusNeedsReview, StatusDone} {
		task := Task{Kind: KindAction, Status: StatusQueued}
		if err := applyTaskStatus(&task, status, true); err != nil {
			t.Fatalf("apply %q: %v", status, err)
		}
		if task.Status != status {
			t.Fatalf("status = %q, want %q", task.Status, status)
		}
		if task.Done != (status == StatusDone) {
			t.Fatalf("done = %v for %q", task.Done, status)
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
	req := httptest.NewRequest("GET", "/api/v1/tasks?boardId=board-1&bucketId=list-1&status=done&done=true&limit=12&cursor=next-page", nil)
	filter, err := taskFilterFromQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if filter.BoardID != "board-1" || filter.BucketID != "list-1" || filter.Status != "done" || filter.Done == nil || !*filter.Done || filter.Limit != 12 || filter.Cursor != "next-page" {
		t.Fatalf("filter = %#v", filter)
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
