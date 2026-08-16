package server

import (
	"context"
	"net/http"
	"time"

	"github.com/azhry/nala-trace/backend/internal/config"
	"github.com/gin-gonic/gin"
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
		Handler:           requestLogger(NewHandler(routes...), nil),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}}
}

func NewHandler(routes ...Route) http.Handler {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())
	for _, route := range routes {
		if route.Pattern == "" || route.Handler == nil {
			continue
		}
		router.Any(route.Pattern, gin.WrapH(route.Handler))
	}
	router.NoRoute(func(context *gin.Context) {
		WriteError(context.Writer, http.StatusNotFound, "not_found", "the requested resource was not found")
	})
	return router
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.HTTP.Shutdown(ctx)
}
