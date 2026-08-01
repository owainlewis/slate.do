package entitlements

import "testing"

func TestProEntitlementUsesOneServerOwnedLimitSet(t *testing.T) {
	entitlement := Pro(SourceInviteCode)
	if entitlement.Plan != PlanPro || entitlement.Source != SourceInviteCode {
		t.Fatalf("entitlement = %#v", entitlement)
	}
	if entitlement.Limits != ProLimits {
		t.Fatalf("limits = %#v, want %#v", entitlement.Limits, ProLimits)
	}
}

func TestPlanCatalogDefinesLaunchLimits(t *testing.T) {
	free, ok := LimitsForPlan(PlanFree)
	if !ok || free != FreeLimits {
		t.Fatalf("free limits = %#v, %v", free, ok)
	}
	if free.Boards != 1 || free.ListsPerBoard != 5 || free.ActiveItemsPerList != 20 || free.Agents != 1 || free.StoredTasks != 500 || free.StoredContentBytes != 10*1024*1024 || free.APITokens != 3 {
		t.Fatalf("free limits = %#v", free)
	}
	pro, ok := LimitsForPlan(PlanPro)
	if !ok || pro != ProLimits {
		t.Fatalf("pro limits = %#v, %v", pro, ok)
	}
	if pro.Boards != 5 || pro.ListsPerBoard != 9 || pro.ActiveItemsPerList != 20 || pro.Agents != 5 || pro.StoredTasks != 10_000 || pro.StoredContentBytes != 250*1024*1024 || pro.APITokens != 20 {
		t.Fatalf("pro limits = %#v", pro)
	}
}

func TestResolveDefaultsToFreeAndPreservesGrantSources(t *testing.T) {
	if got := Resolve("member", "", ""); got != Free() {
		t.Fatalf("default entitlement = %#v", got)
	}
	for _, source := range []string{SourceInviteCode, SourceManual, SourceStripe} {
		t.Run(source, func(t *testing.T) {
			if got := Resolve("member", PlanPro, source); got != Pro(source) {
				t.Fatalf("%s entitlement = %#v", source, got)
			}
		})
	}
	if got := Resolve("admin", "", ""); got != Pro(SourceAdmin) {
		t.Fatalf("admin entitlement = %#v", got)
	}
}
