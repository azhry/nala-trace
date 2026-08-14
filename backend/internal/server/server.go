package server

import (
	"context"
	"net/http"
	"time"

	"github.com/azhry/nala-trace/backend/internal/config"
)

type Route struct {
	Pattern string
	Handler http.Handler
}

type Server struct {
	HTTP *http.Server
}

func New(cfg config.Config, routes ...Route) *Server {
	return &Server{HTTP: &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           NewHandler(routes...),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}}
}

func NewHandler(routes ...Route) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		WriteError(w, http.StatusNotFound, "not_found", "the requested resource was not found")
	}))
	for _, route := range routes {
		if route.Pattern == "" || route.Handler == nil {
			continue
		}
		mux.Handle(route.Pattern, route.Handler)
	}
	return mux
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.HTTP.Shutdown(ctx)
}
