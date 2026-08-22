package auth

import (
	"errors"
	"testing"
)

func TestDecodeUserAcceptsNalaLabsEntitlementObject(t *testing.T) {
	user, err := decodeUser([]byte(`{
		"authenticated": true,
		"user": {
			"id": "nala-admin-test",
			"name": "nala-admin-test",
			"email": "nala-admin-test@example.com",
			"tier": "admin",
			"entitlements": {
				"maxDeployments": null,
				"maxDatabases": null,
				"expires": false,
				"policy": "Full platform access"
			}
		}
	}`), true)
	if err != nil {
		t.Fatalf("decodeUser returned error: %v", err)
	}
	if user.ID != "nala-admin-test" || user.Tier != TierAdmin {
		t.Fatalf("unexpected decoded user: %#v", user)
	}
	if len(user.Entitlements) != 0 {
		t.Fatalf("object entitlements should not be converted into invented list values: %#v", user.Entitlements)
	}
}

func TestDecodeUserPreservesEntitlementList(t *testing.T) {
	user, err := decodeUser([]byte(`{
		"authenticated": true,
		"user": {
			"id": "developer",
			"roles": ["developer"],
			"entitlements": ["trace:read", "trace:write"]
		}
	}`), true)
	if err != nil {
		t.Fatalf("decodeUser returned error: %v", err)
	}
	if got, want := user.Entitlements, []string{"trace:read", "trace:write"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("entitlements = %#v, want %#v", got, want)
	}
}

func TestDecodeUserRejectsInvalidEntitlementShape(t *testing.T) {
	_, err := decodeUser([]byte(`{
		"authenticated": true,
		"user": {"id": "invalid", "entitlements": "not-an-object"}
	}`), true)
	if !errors.Is(err, ErrMalformedProviderData) {
		t.Fatalf("error = %v, want ErrMalformedProviderData", err)
	}
}
