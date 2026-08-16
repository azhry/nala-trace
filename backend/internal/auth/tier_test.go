package auth

import "testing"

func TestNormalizeTierTable(t *testing.T) {
	tests := []struct {
		name   string
		claims Claims
		want   Tier
	}{
		{name: "admin flag wins", claims: Claims{Admin: true, Roles: []string{"developer"}}, want: TierAdmin},
		{name: "admin role wins", claims: Claims{Roles: []string{"free", " ADMIN "}}, want: TierAdmin},
		{name: "developer role", claims: Claims{Roles: []string{"Developer"}}, want: TierDeveloper},
		{name: "developer group", claims: Claims{Groups: []string{"developer"}}, want: TierDeveloper},
		{name: "free tag", claims: Claims{Tags: []string{"free"}}, want: TierFree},
		{name: "unknown defaults free", claims: Claims{Roles: []string{"operator"}}, want: TierFree},
		{name: "missing defaults free", claims: Claims{}, want: TierFree},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := NormalizeTier(test.claims); got != test.want {
				t.Fatalf("NormalizeTier() = %q, want %q", got, test.want)
			}
		})
	}
}
