package auth

type Tier string

const (
	TierAdmin     Tier = "Admin"
	TierDeveloper Tier = "Developer"
	TierFree      Tier = "Free"
)

type Claims struct {
	Roles  []string
	Groups []string
	Tags   []string
	Admin  bool
}

type User struct {
	ID           string   `json:"id"`
	Name         string   `json:"name,omitempty"`
	Email        string   `json:"email,omitempty"`
	Tier         Tier     `json:"tier"`
	Entitlements []string `json:"entitlements,omitempty"`
}

func (u User) Valid() bool {
	return u.ID != "" && (u.Tier == TierAdmin || u.Tier == TierDeveloper || u.Tier == TierFree)
}
