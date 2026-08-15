package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/azhry/nala-trace/backend/internal/config"
	"github.com/azhry/nala-trace/backend/internal/server"
	"github.com/azhry/nala-trace/backend/internal/storage"
)

func main() {
	if err := run(); err != nil {
		slog.Error("api stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	mongoStore, err := storage.NewMongoStore(context.Background(), cfg.Mongo)
	if err != nil {
		return err
	}
	if mongoStore != nil {
		defer func() { _ = mongoStore.Close(context.Background()) }()
		repository, repositoryErr := storage.NewHookEventRepository(mongoStore.Database())
		if repositoryErr != nil {
			return repositoryErr
		}
		indexCtx, cancelIndex := context.WithTimeout(context.Background(), cfg.Mongo.ConnectTimeout)
		indexErr := repository.EnsureIndexes(indexCtx)
		cancelIndex()
		if indexErr != nil {
			return indexErr
		}
	}
	var mongoProbe func(context.Context) error
	if mongoStore != nil {
		mongoProbe = mongoStore.Ping
	}
	health := server.NewHealthChecker(cfg, mongoProbe)
	authRoutes := server.NewAuthRoutes(cfg)
	routes := []server.Route{server.HealthRoute(health)}
	routes = append(routes, server.AuthRouteSet(authRoutes)...)
	api := server.New(cfg, routes...)
	shutdownCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		slog.Info("api listening", "addr", cfg.ListenAddr)
		if err := api.HTTP.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
		close(serveErr)
	}()

	select {
	case err := <-serveErr:
		return err
	case <-shutdownCtx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer cancel()
		return api.Shutdown(shutdown)
	}
}
