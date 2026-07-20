package entitlements

const (
	PlanPro          = "pro"
	SourceInviteCode = "invite_code"
	SourceStripe     = "stripe"
	SourceManual     = "manual"
	SourceAdmin      = "admin"
)

type Limits struct {
	Boards             int `json:"boards"`
	ListsPerBoard      int `json:"listsPerBoard"`
	ActiveItemsPerList int `json:"activeItemsPerList"`
}

type Entitlement struct {
	Plan   string `json:"plan"`
	Source string `json:"source"`
	Limits Limits `json:"limits"`
}

var ProLimits = Limits{
	Boards:             5,
	ListsPerBoard:      9,
	ActiveItemsPerList: 20,
}

func Pro(source string) Entitlement {
	return Entitlement{Plan: PlanPro, Source: source, Limits: ProLimits}
}
