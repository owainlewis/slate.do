package boards

import "testing"

func TestDefaultBucketsDescribeWorkAreas(t *testing.T) {
	wantNames := []string{"Inbox", "Product", "Content", "Growth", "Operations"}
	wantGoals := []string{
		"Capture now, organise later",
		"Make the thing more useful",
		"Publish work that teaches or helps",
		"Reach and serve more people",
		"Keep everything running smoothly",
	}

	buckets := defaultBuckets()
	if len(buckets) != len(wantNames) {
		t.Fatalf("len(defaultBuckets()) = %d, want %d", len(buckets), len(wantNames))
	}
	for index, bucket := range buckets {
		if bucket.Name != wantNames[index] {
			t.Errorf("bucket %d name = %q, want %q", index, bucket.Name, wantNames[index])
		}
		if bucket.Goal != wantGoals[index] {
			t.Errorf("bucket %d goal = %q, want %q", index, bucket.Goal, wantGoals[index])
		}
		if bucket.LimitCount != defaultMaxTasksPerList {
			t.Errorf("bucket %d limit = %d, want %d", index, bucket.LimitCount, defaultMaxTasksPerList)
		}
		if bucket.IsInbox != (index == 0) {
			t.Errorf("bucket %d IsInbox = %v, want %v", index, bucket.IsInbox, index == 0)
		}
	}
}
