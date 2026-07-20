package entitlements

import "testing"

func TestProEntitlementUsesOneServerOwnedLimitSet(t *testing.T) {
	entitlement := Pro(SourceInviteCode)
	if entitlement.Plan != PlanPro || entitlement.Source != SourceInviteCode {
		t.Fatalf("entitlement = %#v", entitlement)
	}
	if entitlement.Limits.Boards != 5 || entitlement.Limits.ListsPerBoard != 9 || entitlement.Limits.ActiveItemsPerList != 20 {
		t.Fatalf("limits = %#v, want 5/9/20", entitlement.Limits)
	}
}
