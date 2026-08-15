package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/azhry/nala-trace/backend/internal/auth"
	"github.com/azhry/nala-trace/backend/internal/config"
)

type AuthRoutes struct {
	Sessions *auth.SessionManager
	IAM      *auth.IAMClient
}

// ProtectedRoute keeps authentication explicit at each API boundary. Health
// and other liveness routes are registered directly and are never wrapped.
func ProtectedRoute(pattern string, handler http.Handler, middleware *auth.Middleware) Route {
	if middleware != nil {
		handler = middleware.Handler(handler)
	}
	return Route{Pattern: pattern, Handler: handler}
}

func AuthRouteSet(routes AuthRoutes) []Route {
	return []Route{
		{Pattern: "/api/auth/login", Handler: http.HandlerFunc(routes.login)},
		{Pattern: "/api/auth/session", Handler: http.HandlerFunc(routes.session)},
		{Pattern: "/api/auth/callback", Handler: http.HandlerFunc(routes.callback)},
		{Pattern: "/api/auth/logout", Handler: http.HandlerFunc(routes.logout)},
	}
}

func NewAuthRoutes(cfg config.Config) AuthRoutes {
	return AuthRoutes{Sessions: auth.NewSessionManager(cfg.Session), IAM: auth.NewIAMClient(cfg.Auth)}
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (routes AuthRoutes) login(w http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	var input loginRequest
	decoder := json.NewDecoder(io.LimitReader(request.Body, 64*1024))
	if err := decoder.Decode(&input); err != nil || strings.TrimSpace(input.Username) == "" || input.Password == "" {
		WriteError(w, http.StatusBadRequest, "invalid_credentials", "credentials are required")
		return
	}
	user, err := routes.IAM.Login(request.Context(), input.Username, input.Password)
	if err != nil {
		writeAuthUpstreamError(w, err)
		return
	}
	session := toSession(user)
	if err := routes.Sessions.Create(w, session); err != nil {
		if errors.Is(err, auth.ErrSessionSecret) {
			WriteError(w, http.StatusServiceUnavailable, "session_unavailable", "application session unavailable")
			return
		}
		WriteError(w, http.StatusInternalServerError, "session_unavailable", "application session unavailable")
		return
	}
	WriteJSON(w, http.StatusOK, sessionResponse(session))
}

func (routes AuthRoutes) session(w http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	session, err := routes.Sessions.Get(request)
	if err != nil {
		status := http.StatusUnauthorized
		code := "unauthenticated"
		if errors.Is(err, auth.ErrSessionSecret) {
			status = http.StatusServiceUnavailable
			code = "session_unavailable"
		}
		WriteError(w, status, code, code)
		return
	}
	WriteJSON(w, http.StatusOK, sessionResponse(session))
}

func (routes AuthRoutes) callback(w http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	var (
		user auth.User
		err  error
	)
	if token := strings.TrimSpace(request.URL.Query().Get("token")); token != "" {
		user, err = routes.IAM.ValidateBearer(request.Context(), token)
	} else if token := strings.TrimSpace(request.URL.Query().Get("access_token")); token != "" {
		user, err = routes.IAM.ValidateBearer(request.Context(), token)
	} else if code := strings.TrimSpace(request.URL.Query().Get("code")); code != "" {
		user, err = routes.IAM.Callback(request.Context(), code)
	} else {
		WriteError(w, http.StatusBadRequest, "invalid_callback", "callback value is required")
		return
	}
	if err != nil {
		writeAuthUpstreamError(w, err)
		return
	}
	session := toSession(user)
	if err := routes.Sessions.Create(w, session); err != nil {
		WriteError(w, http.StatusServiceUnavailable, "session_unavailable", "application session unavailable")
		return
	}
	WriteJSON(w, http.StatusOK, sessionResponse(session))
}

func (routes AuthRoutes) logout(w http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
		return
	}
	routes.Sessions.Clear(w, request)
	w.WriteHeader(http.StatusNoContent)
}

func writeAuthUpstreamError(w http.ResponseWriter, err error) {
	if errors.Is(err, auth.ErrUnauthenticated) {
		WriteError(w, http.StatusUnauthorized, "unauthenticated", "authentication failed")
		return
	}
	WriteError(w, http.StatusServiceUnavailable, "auth_provider_unavailable", "authentication provider unavailable")
}

func toSession(user auth.User) auth.Session {
	return auth.Session{UserID: user.ID, Name: user.Name, Email: user.Email, Tier: user.Tier}
}

func sessionResponse(session auth.Session) map[string]string {
	response := map[string]string{"id": session.UserID, "tier": string(session.Tier)}
	if session.Name != "" {
		response["name"] = session.Name
	}
	if session.Email != "" {
		response["email"] = session.Email
	}
	return response
}
