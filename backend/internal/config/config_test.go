package config

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLoadFromUsesSafeDefaults(t *testing.T) {
	cfg, err := LoadFrom(map[string]string{})
	if err != nil {
		t.Fatalf("LoadFrom returned error: %v", err)
	}
	if cfg.ListenAddr != ":3003" || cfg.FrontendURL != "http://localhost:5005/" || cfg.AllowedOrigin != "http://localhost:5005" || cfg.Mongo.URI != "mongodb://127.0.0.1:27017" || cfg.Auth.NalaLabsAuthURL != "http://127.0.0.1:18080" || cfg.Vault.KVMount != "secret" || cfg.Vault.KVPath != "nala-labs/nala-trace" || cfg.Health.PostgreSQLAddress != "127.0.0.1:5432" || cfg.Health.RedisAddress != "127.0.0.1:6379" || cfg.Health.KafkaAddress != "127.0.0.1:9092" {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if cfg.Mongo.Enabled {
		t.Fatal("Mongo should be disabled by default")
	}
}

func TestLoadFromRejectsInvalidNalaLabsAuthURL(t *testing.T) {
	_, err := LoadFrom(map[string]string{"NALA_LABS_AUTH_URL": "not-a-url"})
	if err == nil || !strings.Contains(err.Error(), "NALA_LABS_AUTH_URL") {
		t.Fatalf("expected named Nala Labs auth URL error, got %v", err)
	}
}

func TestLoadFromUsesVaultKVPath(t *testing.T) {
	cfg, err := LoadFrom(map[string]string{
		"VAULT_ENABLED":  "true",
		"VAULT_ADDR":     "http://vault.example",
		"VAULT_KV_MOUNT": "kv",
		"VAULT_KV_PATH":  "nala-trace/test",
	})
	if err != nil {
		t.Fatalf("LoadFrom returned error: %v", err)
	}
	if cfg.Vault.KVMount != "kv" || cfg.Vault.KVPath != "nala-trace/test" {
		t.Fatalf("unexpected Vault path configuration: %+v", cfg.Vault)
	}
}

func TestLoadVaultValuesUsesKVV2AndPreservesProcessOverrides(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/secret/data/nala-labs/nala-trace" {
			t.Fatalf("Vault request path = %q", r.URL.Path)
		}
		if r.Header.Get("X-Vault-Token") != "test-token" {
			t.Fatalf("Vault token header was not sent")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"data":{"MONGO_URI":"vault-mongo-uri","SESSION_SECRET":"vault-session"}}}`))
	}))
	defer server.Close()

	values := map[string]string{
		"VAULT_ENABLED":  "true",
		"VAULT_ADDR":     server.URL,
		"VAULT_KV_MOUNT": "secret",
		"VAULT_KV_PATH":  "nala-labs/nala-trace",
		"VAULT_TOKEN":    "test-token",
		"SESSION_SECRET": "process-session",
	}
	processValues := map[string]string{"SESSION_SECRET": "process-session"}
	if err := loadVaultValues(values, processValues, server.Client()); err != nil {
		t.Fatalf("load Vault values: %v", err)
	}
	if values["MONGO_URI"] != "vault-mongo-uri" {
		t.Fatalf("MONGO_URI = %q, want Vault value", values["MONGO_URI"])
	}
	if values["SESSION_SECRET"] != "process-session" {
		t.Fatalf("SESSION_SECRET = %q, want process override", values["SESSION_SECRET"])
	}
}

func TestLoadFromRejectsEnabledMongoWithoutRequiredSettings(t *testing.T) {
	_, err := LoadFrom(map[string]string{"MONGO_ENABLED": "true"})
	if err == nil {
		t.Fatal("expected missing Mongo settings error")
	}
	message := err.Error()
	for _, name := range []string{"MONGO_URI", "MONGO_DATABASE"} {
		if !strings.Contains(message, name) {
			t.Fatalf("error %q does not name %s", message, name)
		}
	}
	if strings.Contains(message, "mongodb://") {
		t.Fatalf("error leaked a connection value: %q", message)
	}
}

func TestLoadFromRejectsInvalidDurationWithoutEchoingValue(t *testing.T) {
	_, err := LoadFrom(map[string]string{"SESSION_TTL": "not-a-duration"})
	if err == nil || !strings.Contains(err.Error(), "SESSION_TTL") {
		t.Fatalf("expected named duration error, got %v", err)
	}
	if strings.Contains(err.Error(), "not-a-duration") {
		t.Fatalf("error echoed supplied value: %v", err)
	}
}

func TestRedactRemovesMongoPasswordFromURI(t *testing.T) {
	redacted := Redact("mongodb://user:password@localhost:27017/nala_trace")
	if strings.Contains(redacted, "password") || !strings.Contains(redacted, "REDACTED") {
		t.Fatalf("unexpected redaction: %s", redacted)
	}
}

func TestLoadFromParsesOverrides(t *testing.T) {
	cfg, err := LoadFrom(map[string]string{
		"AUTH_LISTEN_ADDR":      ":18080",
		"FRONTEND_URL":          "http://localhost:18081/",
		"AUTH_ALLOWED_ORIGIN":   "http://localhost:18081",
		"NALA_LABS_AUTH_URL":    "http://localhost:18080",
		"MONGO_ENABLED":         "true",
		"MONGO_URI":             "mongodb://localhost:27017",
		"MONGO_DATABASE":        "test_trace",
		"MONGO_CONNECT_TIMEOUT": "3s",
		"SESSION_TTL":           "30m",
	})
	if err != nil {
		t.Fatalf("LoadFrom returned error: %v", err)
	}
	if cfg.ListenAddr != ":18080" || cfg.Mongo.Database != "test_trace" || cfg.Mongo.ConnectTimeout != 3*time.Second || cfg.Session.TTL != 30*time.Minute {
		t.Fatalf("overrides were not parsed: %+v", cfg)
	}
}
