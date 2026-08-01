package entitlements

const (
	PlanFree         = "free"
	PlanPro          = "pro"
	SourceFree       = "free"
	SourceInviteCode = "invite_code"
	SourceStripe     = "stripe"
	SourceManual     = "manual"
	SourceAdmin      = "admin"
)

type Limits struct {
	Boards             int   `json:"boards"`
	ListsPerBoard      int   `json:"listsPerBoard"`
	ActiveItemsPerList int   `json:"activeItemsPerList"`
	Agents             int   `json:"agents"`
	StoredTasks        int   `json:"storedTasks"`
	StoredContentBytes int64 `json:"storedContentBytes"`
	APITokens          int   `json:"apiTokens"`
}

type Usage struct {
	Boards                int   `json:"boards"`
	MaxListsPerBoard      int   `json:"maxListsPerBoard"`
	MaxActiveItemsPerList int   `json:"maxActiveItemsPerList"`
	Agents                int   `json:"agents"`
	StoredTasks           int   `json:"storedTasks"`
	StoredContentBytes    int64 `json:"storedContentBytes"`
	APITokens             int   `json:"apiTokens"`
}

type Entitlement struct {
	Plan   string `json:"plan"`
	Source string `json:"source"`
	Limits Limits `json:"limits"`
}

var planCatalog = map[string]Limits{
	PlanFree: {
		Boards:             1,
		ListsPerBoard:      5,
		ActiveItemsPerList: 20,
		Agents:             1,
		StoredTasks:        500,
		StoredContentBytes: 10 * 1024 * 1024,
		APITokens:          3,
	},
	PlanPro: {
		Boards:             5,
		ListsPerBoard:      9,
		ActiveItemsPerList: 20,
		Agents:             5,
		StoredTasks:        10_000,
		StoredContentBytes: 250 * 1024 * 1024,
		APITokens:          20,
	},
}

var (
	FreeLimits = planCatalog[PlanFree]
	ProLimits  = planCatalog[PlanPro]
)

func LimitsForPlan(plan string) (Limits, bool) {
	limits, ok := planCatalog[plan]
	return limits, ok
}

func Free() Entitlement {
	return Entitlement{Plan: PlanFree, Source: SourceFree, Limits: FreeLimits}
}

func Pro(source string) Entitlement {
	return Entitlement{Plan: PlanPro, Source: source, Limits: ProLimits}
}

func Resolve(role string, plan string, source string) Entitlement {
	if role == "admin" {
		return Pro(SourceAdmin)
	}
	if plan == PlanPro {
		return Pro(source)
	}
	return Free()
}
