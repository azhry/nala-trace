package auth

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/azhry/nala-trace/backend/internal/config"
)

type contextKey struct{}

func WithUser(ctx context.Context, user User) context.Context {
	return context.WithValue(ctx, contextKey{}, user)
}

func UserFromContext(ctx context.Context) (User, bool) {
	user, ok := ctx.Value(contextKey{}).(User)
	return user, ok && user.Valid()
}

type Middleware struct {
	iam    *IAMClient
	apiKey string
	origin string
}

func NewMiddleware(cfg config.Config, iam *IAMClient) *Middleware {
	return &Middleware{iam: iam, apiKey: cfg.Auth.APIKey, origin: strings.TrimRight(cfg.AllowedOrigin, "/")}
}

func (m *Middleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		m.writeCORS(w, request)
		if request.Method == http.MethodOptions {
			if !m.originAllowed(request) {
				WriteAuthError(w, http.StatusForbidden, "origin_not_allowed")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !m.originAllowed(request) {
			WriteAuthError(w, http.StatusForbidden, "origin_not_allowed")
			return
		}
		user, status, code := m.authenticate(request)
		if status != http.StatusOK {
			WriteAuthError(w, status, code)
			return
		}
		next.ServeHTTP(w, request.WithContext(WithUser(request.Context(), user)))
	})
}

func (m *Middleware) authenticate(request *http.Request) (User, int, string) {
	if m == nil {
		return User{}, http.StatusUnauthorized, "unauthenticated"
	}
	if apiKey := firstHeader(request, "X-Nala-Labs-API-Key", "X-API-Key"); apiKey != "" && m.apiKey != "" && constantTimeEqual(apiKey, m.apiKey) {
		return User{ID: "nala-labs-api-key", Tier: TierAdmin}, http.StatusOK, ""
	}
	authorization := strings.TrimSpace(request.Header.Get("Authorization"))
	if authorization == "" {
		return User{}, http.StatusUnauthorized, "unauthenticated"
	}
	parts := strings.Fields(authorization)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" || m.iam == nil {
		return User{}, http.StatusUnauthorized, "unauthenticated"
	}
	user, err := m.iam.ValidateBearer(request.Context(), parts[1])
	if err == nil && user.Valid() {
		return user, http.StatusOK, ""
	}
	if errors.Is(err, ErrProviderUnavailable) || errors.Is(err, ErrMalformedProviderData) {
		return User{}, http.StatusServiceUnavailable, "auth_provider_unavailable"
	}
	return User{}, http.StatusUnauthorized, "unauthenticated"
}

func (m *Middleware) originAllowed(request *http.Request) bool {
	origin := strings.TrimRight(strings.TrimSpace(request.Header.Get("Origin")), "/")
	return origin == "" || m.origin == "" || origin == m.origin
}

func (m *Middleware) writeCORS(w http.ResponseWriter, request *http.Request) {
	origin := strings.TrimRight(strings.TrimSpace(request.Header.Get("Origin")), "/")
	if origin != "" && m.origin != "" && origin == m.origin {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key, X-Nala-Labs-API-Key")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
}

func firstHeader(request *http.Request, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(request.Header.Get(name)); value != "" {
			return value
		}
	}
	return ""
}

func constantTimeEqual(left, right string) bool {
	if len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func WriteAuthError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"code": code, "message": code},
	})
}
