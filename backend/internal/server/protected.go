package server

import (
	"net/http"

	"github.com/azhry/nala-trace/backend/internal/auth"
)

// ProtectedRoute keeps authentication explicit at each API boundary. Health
// and other liveness routes are registered directly and are never wrapped.
func ProtectedRoute(pattern string, handler http.Handler, middleware *auth.Middleware) Route {
	if middleware != nil {
		handler = middleware.Handler(handler)
	}
	return Route{Pattern: pattern, Handler: handler}
}
