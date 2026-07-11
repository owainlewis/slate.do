package boards

import "testing"

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
