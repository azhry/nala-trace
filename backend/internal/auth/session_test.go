package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/config"
)

func testSessionManager(ttl time.Duration) *SessionManager {
	return NewSessionManager(config.SessionConfig{CookieName: "session", Secret: "test-session-secret", TTL: ttl, CookieSameSite: "Lax"})
}

func TestSessionManagerCreateGetAndCookieAttributes(t *testing.T) {
	manager := testSessionManager(time.Hour)
	response := httptest.NewRecorder()
	if err := manager.Create(response, Session{UserID: "user-1", Name: "User", Tier: TierDeveloper}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	cookie := response.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" || cookie.Name != "session" {
		t.Fatalf("unexpected cookie: %+v", cookie)
	}
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.AddCookie(cookie)
	session, err := manager.Get(request)
	if err != nil || session.UserID != "user-1" || session.Tier != TierDeveloper {
		t.Fatalf("Get = %+v, err=%v", session, err)
	}
}

func TestSessionManagerRejectsMissingExpiredAndTamperedSessions(t *testing.T) {
	manager := testSessionManager(time.Millisecond)
	missing := httptest.NewRequest(http.MethodGet, "/", nil)
	if _, err := manager.Get(missing); err != ErrMissingSession {
		t.Fatalf("missing error = %v", err)
	}
	response := httptest.NewRecorder()
	if err := manager.Create(response, Session{UserID: "user-1", Tier: TierFree}); err != nil {
		t.Fatal(err)
	}
	cookie := response.Result().Cookies()[0]
	time.Sleep(10 * time.Millisecond)
	expired := httptest.NewRequest(http.MethodGet, "/", nil)
	expired.AddCookie(cookie)
	if _, err := manager.Get(expired); err != ErrExpiredSession {
		t.Fatalf("expired error = %v", err)
	}
	tampered := *cookie
	tampered.Value = strings.Replace(cookie.Value, "a", "b", 1)
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.AddCookie(&tampered)
	if _, err := manager.Get(request); err != ErrInvalidSession {
		t.Fatalf("tampered error = %v", err)
	}
}

func TestSessionManagerClearRevokesAndExpiresCookie(t *testing.T) {
	manager := testSessionManager(time.Hour)
	response := httptest.NewRecorder()
	if err := manager.Create(response, Session{UserID: "user-1", Tier: TierFree}); err != nil {
		t.Fatal(err)
	}
	cookie := response.Result().Cookies()[0]
	request := httptest.NewRequest(http.MethodPost, "/logout", nil)
	request.AddCookie(cookie)
	cleared := httptest.NewRecorder()
	manager.Clear(cleared, request)
	if cleared.Result().Cookies()[0].MaxAge != -1 {
		t.Fatalf("logout did not expire cookie: %+v", cleared.Result().Cookies()[0])
	}
	if _, err := manager.Get(request); err != ErrInvalidSession {
		t.Fatalf("revoked session error = %v", err)
	}
}
