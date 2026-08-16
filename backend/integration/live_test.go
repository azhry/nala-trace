//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/auth"
	"github.com/azhry/nala-trace/backend/internal/config"
	"github.com/azhry/nala-trace/backend/internal/events"
	"github.com/azhry/nala-trace/backend/internal/server"
	"github.com/azhry/nala-trace/backend/internal/storage"
	"go.mongodb.org/mongo-driver/bson"
)

func TestLiveDependenciesAndMongoPersistence(t *testing.T) {
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("get integration working directory: %v", err)
	}
	repositoryRoot, err := findRepositoryRoot(workingDirectory)
	if err != nil {
		t.Fatalf("find repository root: %v", err)
	}
	if err := os.Chdir(repositoryRoot); err != nil {
		t.Fatalf("change to repository root: %v", err)
	}
	defer func() { _ = os.Chdir(workingDirectory) }()

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load Vault-backed configuration: %v", err)
	}
	if !cfg.Mongo.Enabled {
		t.Fatalf("Mongo is not enabled by Vault-backed configuration: vault_enabled=%t mongo_uri_non_default=%t database=%q", cfg.Vault.Enabled, cfg.Mongo.URI != "mongodb://127.0.0.1:27017", cfg.Mongo.Database)
	}
	ctx := context.Background()
	store, err := storage.NewMongoStore(ctx, cfg.Mongo)
	if err != nil {
		t.Fatalf("connect and ping live MongoDB: %v", err)
	}
	if store == nil {
		t.Fatal("live MongoDB store was not initialized")
	}
	defer func() { _ = store.Close(context.Background()) }()

	repository, err := storage.NewHookEventRepository(store.Database())
	if err != nil {
		t.Fatalf("create live MongoDB repository: %v", err)
	}
	if err := repository.EnsureIndexes(ctx); err != nil {
		t.Fatalf("create live MongoDB indexes: %v", err)
	}

	api := server.New(
		cfg,
		server.HealthRoute(server.NewHealthChecker(cfg, store.Ping)),
		server.ProtectedRoute("/ingest", server.NewIngestHandler(repository), auth.NewMiddleware(cfg, auth.NewIAMClient(cfg.Auth), nil)),
		server.ProtectedRoute("/sessions", server.NewSessionsHandler(repository), auth.NewMiddleware(cfg, auth.NewIAMClient(cfg.Auth), nil)),
	)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for live Trace API: %v", err)
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- api.HTTP.Serve(listener) }()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = api.Shutdown(shutdownCtx)
		select {
		case err := <-serveErr:
			if err != nil && err != http.ErrServerClosed {
				t.Errorf("live Trace API stopped: %v", err)
			}
		case <-shutdownCtx.Done():
			t.Error("live Trace API did not stop within the shutdown timeout")
		}
	}()

	baseURL := "http://" + listener.Addr().String()
	client := &http.Client{Timeout: 10 * time.Second}
	health := getLiveResponse(t, client, baseURL+"/healthz", "")
	if health.StatusCode != http.StatusOK {
		health.Body.Close()
		t.Fatalf("live /healthz status = %d, want 200", health.StatusCode)
	}
	var healthBody struct {
		Status       string                       `json:"status"`
		Dependencies map[string]map[string]string `json:"dependencies"`
	}
	if err := json.NewDecoder(health.Body).Decode(&healthBody); err != nil {
		health.Body.Close()
		t.Fatalf("decode live /healthz response: %v", err)
	}
	health.Body.Close()
	if healthBody.Status != "ok" {
		t.Fatalf("live /healthz status = %q, want ok; dependencies=%v", healthBody.Status, healthBody.Dependencies)
	}
	for _, dependency := range []string{"casdoor", "vault", "postgresql", "mongodb", "redis", "kafka"} {
		if got := healthBody.Dependencies[dependency]["status"]; got != "ok" {
			t.Fatalf("live /healthz dependency %q = %q, want ok", dependency, got)
		}
	}
	sessionID := fmt.Sprintf("live-integration-%d", time.Now().UnixNano())
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.Database().Collection("hook_events").DeleteMany(cleanupCtx, bson.M{"session_id": sessionID}); err != nil {
			t.Errorf("remove live integration event: %v", err)
		}
	}()
	rawEvent := []byte(fmt.Sprintf(`{"session_id":%q,"hook_event_name":"Stop"}`, sessionID))
	event, err := events.Decode(rawEvent)
	if err != nil {
		t.Fatalf("decode live persistence event: %v", err)
	}
	hookEvent, err := storage.NewHookEvent("live-integration-user", event, time.Now().UTC())
	if err != nil {
		t.Fatalf("build live persistence event: %v", err)
	}
	if err := repository.InsertHookEvent(ctx, hookEvent); err != nil {
		t.Fatalf("insert live MongoDB event: %v", err)
	}
	rows, err := repository.ListSessionSummariesForUser(ctx, "live-integration-user", 10)
	if err != nil {
		t.Fatalf("read live MongoDB session summary: %v", err)
	}
	if len(rows) != 1 || rows[0].SessionID != sessionID || rows[0].EventCount != 1 {
		t.Fatalf("live MongoDB summary = %+v, want one persisted event for %q", rows, sessionID)
	}
}

func TestLiveTraceAPIWithNalaLabsAPIKey(t *testing.T) {
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("get integration working directory: %v", err)
	}
	repositoryRoot, err := findRepositoryRoot(workingDirectory)
	if err != nil {
		t.Fatalf("find repository root: %v", err)
	}
	if err := os.Chdir(repositoryRoot); err != nil {
		t.Fatalf("change to repository root: %v", err)
	}
	defer func() { _ = os.Chdir(workingDirectory) }()

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load Vault-backed configuration: %v", err)
	}
	apiKey := strings.TrimSpace(os.Getenv("CODEX_TRACE_API_TOKEN"))
	if apiKey == "" {
		t.Fatal("CODEX_TRACE_API_TOKEN was not supplied; provide a real Nala Labs API key to the integration process")
	}
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		t.Fatal("DATABASE_URL was not loaded; local Nala Trace API-key validation requires the shared Nala Labs PostgreSQL connection")
	}
	store, err := storage.NewMongoStore(context.Background(), cfg.Mongo)
	if err != nil {
		t.Fatalf("connect and ping live MongoDB: %v", err)
	}
	if store == nil {
		t.Fatal("live MongoDB store was not initialized")
	}
	defer func() { _ = store.Close(context.Background()) }()
	repository, err := storage.NewHookEventRepository(store.Database())
	if err != nil {
		t.Fatalf("create live MongoDB repository: %v", err)
	}
	apiKeyStore, err := auth.NewAPIKeyStore(cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("connect to live Nala Labs PostgreSQL API-key store: %v", err)
	}
	defer func() { _ = apiKeyStore.Close() }()

	api := server.New(
		cfg,
		server.HealthRoute(server.NewHealthChecker(cfg, store.Ping)),
		server.ProtectedRoute("/ingest", server.NewIngestHandler(repository), auth.NewMiddleware(cfg, auth.NewIAMClient(cfg.Auth), apiKeyStore)),
		server.ProtectedRoute("/sessions", server.NewSessionsHandler(repository), auth.NewMiddleware(cfg, auth.NewIAMClient(cfg.Auth), apiKeyStore)),
	)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for live Trace API: %v", err)
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- api.HTTP.Serve(listener) }()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = api.Shutdown(shutdownCtx)
		select {
		case err := <-serveErr:
			if err != nil && err != http.ErrServerClosed {
				t.Errorf("live Trace API stopped: %v", err)
			}
		case <-shutdownCtx.Done():
			t.Error("live Trace API did not stop within the shutdown timeout")
		}
	}()

	client := &http.Client{Timeout: 10 * time.Second}
	baseURL := "http://" + listener.Addr().String()
	sessionID := fmt.Sprintf("live-api-%d", time.Now().UnixNano())
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.Database().Collection("hook_events").DeleteMany(cleanupCtx, bson.M{"session_id": sessionID}); err != nil {
			t.Errorf("remove live API event: %v", err)
		}
	}()

	request, err := http.NewRequest(http.MethodPost, baseURL+"/ingest", strings.NewReader(fmt.Sprintf(`{"session_id":%q,"hook_event_name":"Stop"}`, sessionID)))
	if err != nil {
		t.Fatalf("create live ingest request: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Nala-Labs-API-Key", apiKey)
	insertResponse, err := client.Do(request)
	if err != nil {
		t.Fatalf("call live /ingest: %v", err)
	}
	insertResponse.Body.Close()
	if insertResponse.StatusCode != http.StatusAccepted {
		t.Fatalf("live /ingest status = %d, want 202", insertResponse.StatusCode)
	}

	sessions := getLiveResponse(t, client, baseURL+"/sessions?limit=10", apiKey)
	if sessions.StatusCode != http.StatusOK {
		sessions.Body.Close()
		t.Fatalf("live /sessions status = %d, want 200", sessions.StatusCode)
	}
	var sessionsBody struct {
		Sessions []struct {
			SessionID string `json:"session_id"`
		} `json:"sessions"`
	}
	if err := json.NewDecoder(sessions.Body).Decode(&sessionsBody); err != nil {
		sessions.Body.Close()
		t.Fatalf("decode live /sessions response: %v", err)
	}
	sessions.Body.Close()
	for _, session := range sessionsBody.Sessions {
		if session.SessionID == sessionID {
			return
		}
	}
	t.Fatalf("live /sessions did not return persisted session %q", sessionID)
}

func findRepositoryRoot(start string) (string, error) {
	directory := start
	for {
		if _, err := os.Stat(filepath.Join(directory, ".vault-config")); err == nil {
			return directory, nil
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return "", fmt.Errorf(".vault-config not found above %s", start)
		}
		directory = parent
	}
}

func getLiveResponse(t *testing.T, client *http.Client, endpoint, apiKey string) *http.Response {
	t.Helper()
	var response *http.Response
	var err error
	for attempt := 0; attempt < 20; attempt++ {
		request, requestErr := http.NewRequest(http.MethodGet, endpoint, nil)
		if requestErr != nil {
			t.Fatalf("create live request: %v", requestErr)
		}
		if strings.TrimSpace(apiKey) != "" {
			request.Header.Set("X-Nala-Labs-API-Key", apiKey)
		}
		response, err = client.Do(request)
		if err == nil {
			return response
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("call live endpoint %s: %v", endpoint, err)
	return nil
}
