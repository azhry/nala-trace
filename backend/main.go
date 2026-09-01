package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/azhry/nala-trace/backend/internal/auth"
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
	var repository *storage.HookEventRepository
	var analysisRepository *storage.SessionAnalysisRepository
	if mongoStore != nil {
		defer func() { _ = mongoStore.Close(context.Background()) }()
		repository, err = storage.NewHookEventRepository(mongoStore.Database())
		if err != nil {
			return err
		}
		indexCtx, cancelIndex := context.WithTimeout(context.Background(), cfg.Mongo.ConnectTimeout)
		indexErr := repository.EnsureIndexes(indexCtx)
		cancelIndex()
		if indexErr != nil {
			return indexErr
		}
		analysisRepository, err = storage.NewSessionAnalysisRepository(mongoStore.Database())
		if err != nil {
			return err
		}
		analysisCtx, cancelAnalysisIndex := context.WithTimeout(context.Background(), cfg.Mongo.ConnectTimeout)
		analysisIndexErr := analysisRepository.EnsureIndexes(analysisCtx)
		cancelAnalysisIndex()
		if analysisIndexErr != nil {
			return analysisIndexErr
		}
	}
	var apiKeyStore *auth.APIKeyStore
	if cfg.DatabaseURL != "" {
		apiKeyStore, err = auth.NewAPIKeyStore(cfg.DatabaseURL)
		if err != nil {
			return err
		}
		defer func() { _ = apiKeyStore.Close() }()
	}
	var mongoProbe func(context.Context) error
	if mongoStore != nil {
		mongoProbe = mongoStore.Ping
	}
	var analysisReader storage.SessionAnalysisReader
	var analysisWriter storage.SessionAnalysisWriter
	if analysisRepository != nil {
		analysisReader = analysisRepository
		analysisWriter = analysisRepository
	}
	health := server.NewHealthChecker(cfg, mongoProbe)
	iamClient := auth.NewIAMClient(cfg.Auth)
	middleware := auth.NewMiddleware(cfg, iamClient, apiKeyStore)
	routes := []server.Route{
		server.HealthRoute(health),
		{Pattern: server.TraceHandoffRedeemPath, Handler: server.NewTraceHandoffRedeemHandler(iamClient, cfg.AllowedOrigin)},
		server.ProtectedRoute("/ingest", server.NewIngestHandler(repository), middleware),
		server.ProtectedRoute("/sessions", server.NewSessionsHandler(repository), middleware),
		server.ProtectedRoute("/sessions/:id/annotations", server.NewSessionAnnotationHandler(analysisWriter), middleware),
		server.ProtectedRoute("/sessions/:id/evaluation", server.NewSessionEvaluationHandler(analysisWriter), middleware),
		server.ProtectedRoute("/sessions/:id", server.NewSessionTraceHandler(repository, analysisReader), middleware),
	}
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
