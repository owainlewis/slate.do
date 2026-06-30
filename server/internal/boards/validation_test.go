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

func TestParseDate(t *testing.T) {
	date, err := parseDate("2026-06-30")
	if err != nil {
		t.Fatal(err)
	}
	if date == nil || date.Format("2006-01-02") != "2026-06-30" {
		t.Fatalf("unexpected date: %v", date)
	}
	if _, err := parseDate("30/06/2026"); err == nil {
		t.Fatal("expected invalid date to fail")
	}
}
