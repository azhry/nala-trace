//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/config"
	"github.com/azhry/nala-trace/backend/internal/reconstruction"
	"github.com/azhry/nala-trace/backend/internal/storage"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	defaultAPIBaseURL = "http://127.0.0.1:3003"
	maxLiveBody       = 4 << 20
)

type liveClient struct {
	testing.TB
	baseURL string
	token   string
	http    *http.Client
}

type liveResponse struct {
	status int
	body   []byte
}

type liveSessionResponse struct {
	Sessions []storage.SessionSummary `json:"sessions"`
	Limit    int                      `json:"limit"`
}

type liveHookDocument struct {
	ID            primitive.ObjectID `bson:"_id"`
	UserID        string             `bson:"user_id"`
	SessionID     string             `bson:"session_id"`
	TurnID        *string            `bson:"turn_id"`
	HookEventName string             `bson:"hook_event_name"`
	ToolName      *string            `bson:"tool_name"`
	ToolUseID     *string            `bson:"tool_use_id"`
	Payload       bson.Raw           `bson:"payload"`
	ReceivedAt    time.Time          `bson:"received_at"`
}

func TestLiveContractsAgainstRealDependencies(t *testing.T) {
	baseURL := envOr("API_BASE_URL", defaultAPIBaseURL)
	token := requiredEnv(t, "CODEX_TRACE_API_TOKEN")
	emptyToken := requiredEnv(t, "CODEX_TRACE_EMPTY_API_TOKEN")
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("get integration working directory: %v", err)
	}
	projectRoot, err := filepath.Abs(filepath.Join(workingDirectory, "..", ".."))
	if err != nil {
		t.Fatalf("resolve project root: %v", err)
	}
	if err := os.Chdir(projectRoot); err != nil {
		t.Fatalf("switch to project root for Vault-backed configuration: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load live configuration: %v", err)
	}
	if !cfg.Mongo.Enabled {
		t.Fatal("live configuration did not resolve an enabled MongoDB URI")
	}

	mongoClient, err := mongo.Connect(ctx, options.Client().ApplyURI(cfg.Mongo.URI))
	if err != nil {
		t.Fatalf("connect to live MongoDB: %v", err)
	}
	defer func() { _ = mongoClient.Disconnect(context.Background()) }()
	if err := mongoClient.Ping(ctx, nil); err != nil {
		t.Fatalf("ping live MongoDB: %v", err)
	}
	collection := mongoClient.Database(cfg.Mongo.Database).Collection("hook_events")

	client := &liveClient{TB: t, baseURL: strings.TrimRight(baseURL, "/"), token: token, http: &http.Client{Timeout: 10 * time.Second}}
	emptyClient := &liveClient{TB: t, baseURL: strings.TrimRight(baseURL, "/"), token: emptyToken, http: client.http}

	t.Run("health", func(t *testing.T) {
		response := client.request(ctx, http.MethodGet, "/healthz", "", false)
		assertStatus(t, response, http.StatusOK)
		var payload struct {
			Status       string `json:"status"`
			Dependencies map[string]struct {
				Status string `json:"status"`
			} `json:"dependencies"`
		}
		decodeJSON(t, response, &payload)
		if payload.Status != "ok" {
			t.Fatalf("health status = %q, want ok", payload.Status)
		}
		for _, name := range []string{"casdoor", "kafka", "mongodb", "postgresql", "redis", "vault"} {
			if payload.Dependencies[name].Status != "ok" {
				t.Fatalf("dependency %s status = %q, want ok", name, payload.Dependencies[name].Status)
			}
		}
	})

	t.Run("unauthorized", func(t *testing.T) {
		response := client.request(ctx, http.MethodGet, "/sessions?limit=10", "", false)
		assertStatus(t, response, http.StatusUnauthorized)
		response = client.request(ctx, http.MethodPost, "/ingest", eventJSON("unauthorized", "Stop"), false)
		assertStatus(t, response, http.StatusUnauthorized)
		response = (&liveClient{TB: t, baseURL: client.baseURL, token: "not-a-real-key", http: client.http}).request(ctx, http.MethodGet, "/sessions?limit=10", "", true)
		assertStatus(t, response, http.StatusUnauthorized)
	})

	t.Run("empty-owner-sessions", func(t *testing.T) {
		response := emptyClient.request(ctx, http.MethodGet, "/sessions?limit=100", "", true)
		assertStatus(t, response, http.StatusOK)
		var payload liveSessionResponse
		decodeJSON(t, response, &payload)
		if len(payload.Sessions) != 0 {
			t.Fatalf("fresh owner returned %d sessions, want 0", len(payload.Sessions))
		}
	})

	sessionID := fmt.Sprintf("live-integration-%d", time.Now().UnixNano())
	baseEvents := []string{"SessionStart", "UserPromptSubmit", "PreToolUse", "PreToolUseDuplicate", "PostToolUse", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "Stop"}
	for _, eventName := range baseEvents {
		response := client.request(ctx, http.MethodPost, "/ingest", eventJSON(sessionID, eventName), true)
		assertStatus(t, response, http.StatusAccepted)
		var accepted struct {
			Accepted bool `json:"accepted"`
		}
		decodeJSON(t, response, &accepted)
		if !accepted.Accepted {
			t.Fatalf("%s ingest was not accepted", eventName)
		}
	}

	countBeforeMalformed := countSessionDocuments(t, ctx, collection, sessionID)
	response := client.request(ctx, http.MethodPost, "/ingest", `{"hook_event_name":"Stop"}`, true)
	assertStatus(t, response, http.StatusBadRequest)
	assertErrorCode(t, response, "invalid_event")
	if countAfterMalformed := countSessionDocuments(t, ctx, collection, sessionID); countAfterMalformed != countBeforeMalformed {
		t.Fatalf("malformed request changed MongoDB count from %d to %d", countBeforeMalformed, countAfterMalformed)
	}

	extraEvents := []string{"Stop", "PostToolUseOrphan", "PreToolUseMissingID", "StopMalformedTimestamp"}
	for _, eventName := range extraEvents {
		response := client.request(ctx, http.MethodPost, "/ingest", eventJSON(sessionID, eventName), true)
		assertStatus(t, response, http.StatusAccepted)
	}
	response = client.request(ctx, http.MethodPost, "/ingest", eventJSON(sessionID, "Stop"), true)
	assertStatus(t, response, http.StatusAccepted)

	response = client.request(ctx, http.MethodGet, "/sessions?limit=0", "", true)
	assertStatus(t, response, http.StatusBadRequest)
	assertErrorCode(t, response, "invalid_query")

	response = client.request(ctx, http.MethodGet, "/sessions?limit=100", "", true)
	assertStatus(t, response, http.StatusOK)
	var sessions liveSessionResponse
	decodeJSON(t, response, &sessions)
	var summary *storage.SessionSummary
	for index := range sessions.Sessions {
		if sessions.Sessions[index].SessionID == sessionID {
			summary = &sessions.Sessions[index]
			break
		}
	}
	if summary == nil {
		t.Fatalf("session %s was not returned for its owner", sessionID)
	}
	if summary.UserID == "" || summary.EventCount != int64(len(baseEvents)+len(extraEvents)+1) {
		t.Fatalf("session summary = %+v, want owner and %d events", *summary, len(baseEvents)+len(extraEvents)+1)
	}

	documents := readSessionDocuments(t, ctx, collection, sessionID)
	if len(documents) != int(summary.EventCount) {
		t.Fatalf("MongoDB returned %d documents, session summary reported %d", len(documents), summary.EventCount)
	}
	setEqualReceivedAt(t, ctx, collection, documents)
	documents = readSessionDocuments(t, ctx, collection, sessionID)
	traceEvents := make([]storage.HookEvent, 0, len(documents))
	for _, document := range documents {
		id := document.ID.Hex()
		traceEvents = append(traceEvents, storage.HookEvent{
			ID:            id,
			UserID:        document.UserID,
			SessionID:     document.SessionID,
			TurnID:        document.TurnID,
			HookEventName: document.HookEventName,
			ToolName:      document.ToolName,
			ToolUseID:     document.ToolUseID,
			Payload:       document.Payload,
			ReceivedAt:    document.ReceivedAt,
		})
	}
	trace := reconstruction.Reconstruct(sessionID, summary.UserID, traceEvents)
	if len(trace.Timeline) != len(traceEvents) || len(trace.ToolCalls) != 4 {
		t.Fatalf("reconstructed trace has %d timeline events and %d tool calls, want %d and 4", len(trace.Timeline), len(trace.ToolCalls), len(traceEvents))
	}
	if trace.ToolCalls[0].Status != "completed" {
		t.Fatalf("paired tool call status = %q, want completed", trace.ToolCalls[0].Status)
	}
	partialReasons := make([]string, 0)
	for _, event := range trace.Timeline {
		if event.PartialReason != "" {
			partialReasons = append(partialReasons, event.PartialReason)
		}
	}
	sort.Strings(partialReasons)
	joinedReasons := strings.Join(partialReasons, ";")
	for _, expected := range []string{"duplicate_tool_use_id", "malformed_timestamp", "missing_tool_use_id", "unmatched_post_tool_use"} {
		if !strings.Contains(joinedReasons, expected) {
			t.Fatalf("reconstruction partial reasons %q do not contain %q", joinedReasons, expected)
		}
	}
}

func (c *liveClient) request(ctx context.Context, method, path, body string, authenticated bool) liveResponse {
	requestBody := strings.NewReader(body)
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, requestBody)
	if err != nil {
		c.Fatalf("create live request: %v", err)
	}
	request.Header.Set("Origin", "")
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if authenticated {
		request.Header.Set("X-Nala-Labs-API-Key", c.token)
	}
	response, err := c.http.Do(request)
	if err != nil {
		c.Fatalf("send live request %s %s: %v", method, path, err)
	}
	defer response.Body.Close()
	bodyBytes, err := io.ReadAll(io.LimitReader(response.Body, maxLiveBody))
	if err != nil {
		c.Fatalf("read live response %s %s: %v", method, path, err)
	}
	return liveResponse{status: response.StatusCode, body: bodyBytes}
}

func eventJSON(sessionID, name string) string {
	payload := map[string]any{"session_id": sessionID}
	switch name {
	case "PreToolUse", "PreToolUseDuplicate":
		payload["hook_event_name"] = "PreToolUse"
		payload["tool_use_id"] = "tool-live"
		payload["tool_name"] = "shell"
		payload["tool_input"] = map[string]string{"command": "true"}
	case "PostToolUse":
		payload["hook_event_name"] = name
		payload["tool_use_id"] = "tool-live"
		payload["tool_name"] = "shell"
		payload["tool_response"] = map[string]any{"exit_code": 0}
	case "PostToolUseOrphan":
		payload["hook_event_name"] = "PostToolUse"
		payload["tool_use_id"] = "tool-orphan"
		payload["tool_name"] = "shell"
		payload["tool_response"] = map[string]any{"exit_code": 1}
	case "PreToolUseMissingID":
		payload["hook_event_name"] = "PreToolUse"
		payload["tool_name"] = "shell"
		payload["tool_input"] = map[string]string{"command": "true"}
	case "StopMalformedTimestamp":
		payload["hook_event_name"] = "Stop"
		payload["timestamp"] = "not-a-timestamp"
	default:
		payload["hook_event_name"] = name
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

func readSessionDocuments(t testing.TB, ctx context.Context, collection *mongo.Collection, sessionID string) []liveHookDocument {
	t.Helper()
	cursor, err := collection.Find(ctx, bson.D{{Key: "session_id", Value: sessionID}})
	if err != nil {
		t.Fatalf("query live MongoDB session: %v", err)
	}
	defer cursor.Close(ctx)
	var documents []liveHookDocument
	if err := cursor.All(ctx, &documents); err != nil {
		t.Fatalf("decode live MongoDB session: %v", err)
	}
	return documents
}

func countSessionDocuments(t testing.TB, ctx context.Context, collection *mongo.Collection, sessionID string) int {
	t.Helper()
	count, err := collection.CountDocuments(ctx, bson.D{{Key: "session_id", Value: sessionID}})
	if err != nil {
		t.Fatalf("count live MongoDB session: %v", err)
	}
	return int(count)
}

func setEqualReceivedAt(t testing.TB, ctx context.Context, collection *mongo.Collection, documents []liveHookDocument) {
	t.Helper()
	if len(documents) < 2 {
		t.Fatalf("need at least two live documents for equal-timestamp ordering")
	}
	timestamp := time.Unix(0, 0).UTC()
	for _, document := range documents[:2] {
		if _, err := collection.UpdateOne(ctx, bson.D{{Key: "_id", Value: document.ID}}, bson.D{{Key: "$set", Value: bson.D{{Key: "received_at", Value: timestamp}}}}); err != nil {
			t.Fatalf("set equal live timestamps: %v", err)
		}
	}
}

func assertStatus(t testing.TB, response liveResponse, expected int) {
	t.Helper()
	if response.status != expected {
		t.Fatalf("HTTP status = %d, want %d; body=%s", response.status, expected, strings.TrimSpace(string(response.body)))
	}
}

func assertErrorCode(t testing.TB, response liveResponse, expected string) {
	t.Helper()
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	decodeJSON(t, response, &payload)
	if payload.Error.Code != expected {
		t.Fatalf("error code = %q, want %q", payload.Error.Code, expected)
	}
}

func decodeJSON(t testing.TB, response liveResponse, target any) {
	t.Helper()
	if err := json.Unmarshal(response.body, target); err != nil {
		t.Fatalf("decode HTTP %d response: %v; body=%s", response.status, err, strings.TrimSpace(string(response.body)))
	}
}

func requiredEnv(t testing.TB, key string) string {
	t.Helper()
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		t.Fatalf("required live verification environment variable %s is missing", key)
	}
	return value
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
