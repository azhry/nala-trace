package auth

import "strings"

func NormalizeTier(claims Claims) Tier {
	if claims.Admin || hasLabel(claims, "admin") {
		return TierAdmin
	}
	if hasLabel(claims, "developer") {
		return TierDeveloper
	}
	return TierFree
}

func hasLabel(claims Claims, wanted string) bool {
	for _, values := range [][]string{claims.Roles, claims.Groups, claims.Tags} {
		for _, value := range values {
			if strings.EqualFold(strings.TrimSpace(value), wanted) {
				return true
			}
		}
	}
	return false
}
