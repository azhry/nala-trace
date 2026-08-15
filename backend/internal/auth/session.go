package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/azhry/nala-trace/backend/internal/config"
)

var (
	ErrMissingSession = errors.New("session missing")
	ErrInvalidSession = errors.New("session invalid")
	ErrExpiredSession = errors.New("session expired")
	ErrSessionSecret  = errors.New("session secret unavailable")
)

type sessionEnvelope struct {
	Session
	IssuedAt int64  `json:"iat"`
	Expires  int64  `json:"exp"`
	JTI      string `json:"jti"`
}

type SessionManager struct {
	cfg     config.SessionConfig
	mu      sync.Mutex
	revoked map[string]time.Time
}

func NewSessionManager(cfg config.SessionConfig) *SessionManager {
	return &SessionManager{cfg: cfg, revoked: make(map[string]time.Time)}
}

func (m *SessionManager) Create(w http.ResponseWriter, session Session) error {
	if m == nil || len(m.cfg.Secret) == 0 {
		return ErrSessionSecret
	}
	if !session.Valid() {
		return ErrInvalidSession
	}
	now := time.Now().UTC()
	jti, err := randomID()
	if err != nil {
		return ErrInvalidSession
	}
	envelope := sessionEnvelope{Session: session, IssuedAt: now.UnixNano(), Expires: now.Add(m.cfg.TTL).UnixNano(), JTI: jti}
	if envelope.Expires <= envelope.IssuedAt {
		return ErrInvalidSession
	}
	token, err := m.encode(envelope)
	if err != nil {
		return ErrInvalidSession
	}
	http.SetCookie(w, &http.Cookie{
		Name:     m.cookieName(),
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   m.cfg.CookieSecure,
		SameSite: m.sameSite(),
		MaxAge:   maxCookieAge(time.Until(time.Unix(0, envelope.Expires))),
		Expires:  time.Unix(0, envelope.Expires).UTC(),
	})
	return nil
}

func (m *SessionManager) Get(request *http.Request) (Session, error) {
	if m == nil || len(m.cfg.Secret) == 0 {
		return Session{}, ErrSessionSecret
	}
	cookie, err := request.Cookie(m.cookieName())
	if err != nil || cookie.Value == "" {
		return Session{}, ErrMissingSession
	}
	envelope, err := m.decode(cookie.Value)
	if err != nil {
		return Session{}, ErrInvalidSession
	}
	now := time.Now().UTC()
	if envelope.Expires <= now.UnixNano() {
		return Session{}, ErrExpiredSession
	}
	m.mu.Lock()
	_, revoked := m.revoked[envelope.JTI]
	m.mu.Unlock()
	if revoked {
		return Session{}, ErrInvalidSession
	}
	if !envelope.Session.Valid() {
		return Session{}, ErrInvalidSession
	}
	return envelope.Session, nil
}

func (m *SessionManager) Clear(w http.ResponseWriter, request *http.Request) {
	if m != nil && request != nil {
		if cookie, err := request.Cookie(m.cookieName()); err == nil {
			if envelope, decodeErr := m.decode(cookie.Value); decodeErr == nil {
				m.mu.Lock()
				m.revoked[envelope.JTI] = time.Now().UTC().Add(m.cfg.TTL)
				m.mu.Unlock()
			}
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name:     m.cookieName(),
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   m.cfg.CookieSecure,
		SameSite: m.sameSite(),
		MaxAge:   -1,
		Expires:  time.Unix(1, 0).UTC(),
	})
}

func (m *SessionManager) cookieName() string {
	if m == nil || m.cfg.CookieName == "" {
		return "nala_trace_session"
	}
	return m.cfg.CookieName
}

func (m *SessionManager) sameSite() http.SameSite {
	switch m.cfg.CookieSameSite {
	case "Strict", "strict":
		return http.SameSiteStrictMode
	case "None", "none":
		return http.SameSiteNoneMode
	default:
		return http.SameSiteLaxMode
	}
}

func (m *SessionManager) encode(envelope sessionEnvelope) (string, error) {
	payload, err := json.Marshal(envelope)
	if err != nil {
		return "", err
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	return encodedPayload + "." + base64.RawURLEncoding.EncodeToString(m.sign([]byte(encodedPayload))), nil
}

func (m *SessionManager) decode(token string) (sessionEnvelope, error) {
	parts := splitToken(token)
	if len(parts) != 2 {
		return sessionEnvelope{}, ErrInvalidSession
	}
	provided, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return sessionEnvelope{}, ErrInvalidSession
	}
	expected := m.sign([]byte(parts[0]))
	if subtle.ConstantTimeCompare(provided, expected) != 1 {
		return sessionEnvelope{}, ErrInvalidSession
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return sessionEnvelope{}, ErrInvalidSession
	}
	var envelope sessionEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil || envelope.JTI == "" {
		return sessionEnvelope{}, ErrInvalidSession
	}
	return envelope, nil
}

func (m *SessionManager) sign(payload []byte) []byte {
	digest := hmac.New(sha256.New, []byte(m.cfg.Secret))
	_, _ = digest.Write(payload)
	return digest.Sum(nil)
}

func splitToken(value string) []string {
	for index, character := range value {
		if character == '.' {
			return []string{value[:index], value[index+1:]}
		}
	}
	return nil
}

func randomID() (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func maxCookieAge(duration time.Duration) int {
	seconds := int(duration / time.Second)
	if seconds < 1 {
		return 1
	}
	return seconds
}
