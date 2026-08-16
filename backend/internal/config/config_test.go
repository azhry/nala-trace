package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadFromUsesSafeDefaults(t *testing.T) {
	cfg, err := LoadFrom(map[string]string{})
	if err != nil {
		t.Fatalf("LoadFrom returned error: %v", err)
	}
	if cfg.ListenAddr != ":3003" || cfg.FrontendURL != "http://localhost:5005/" || cfg.AllowedOrigin != "http://localhost:5005" || cfg.Mongo.URI != "mongodb://127.0.0.1:27017" || cfg.Auth.NalaLabsAuthURL != "http://127.0.0.1:8080" || cfg.Vault.KVMount != "secret" || cfg.Vault.KVPath != "nala-labs/nala-trace" || cfg.Health.PostgreSQLAddress != "127.0.0.1:5432" || cfg.Health.RedisAddress != "127.0.0.1:6379" || cfg.Health.KafkaAddress != "127.0.0.1:9092" {
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

func TestLoadFromInfersVaultEnabledFromConfiguredTransport(t *testing.T) {
	cfg, err := LoadFrom(map[string]string{
		"VAULT_ADDR":    "http://vault.example",
		"VAULT_TOKEN":   "test-token",
		"VAULT_KV_PATH": "nala-labs/nala-trace",
	})
	if err != nil {
		t.Fatalf("LoadFrom returned error: %v", err)
	}
	if !cfg.Vault.Enabled {
		t.Fatal("Vault should be enabled when its transport is configured")
	}
}

func TestLoadFromEnablesMongoWhenURIIsConfigured(t *testing.T) {
	cfg, err := LoadFrom(map[string]string{
		"MONGO_URI":      "mongodb://vault.example:27017",
		"MONGO_DATABASE": "nala_trace",
	})
	if err != nil {
		t.Fatalf("LoadFrom returned error: %v", err)
	}
	if !cfg.Mongo.Enabled {
		t.Fatal("Mongo should be enabled when its URI is supplied")
	}
}

func TestLoadFromDoesNotRequireIngestTokenForServerStartup(t *testing.T) {
	_, err := LoadFrom(map[string]string{
		"VAULT_ADDR":     "http://vault.example",
		"VAULT_KV_MOUNT": "secret",
		"VAULT_KV_PATH":  "nala-labs/nala-trace",
	})
	if err != nil {
		t.Fatalf("server configuration unexpectedly requires ingest token: %v", err)
	}
}

func TestLoadFromRejectsInvalidDurationWithoutEchoingValue(t *testing.T) {
	_, err := LoadFrom(map[string]string{"AUTH_REQUEST_TIMEOUT": "not-a-duration"})
	if err == nil || !strings.Contains(err.Error(), "AUTH_REQUEST_TIMEOUT") {
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
		"MONGO_URI":             "mongodb://localhost:27017",
		"MONGO_DATABASE":        "test_trace",
		"MONGO_CONNECT_TIMEOUT": "3s",
	})
	if err != nil {
		t.Fatalf("LoadFrom returned error: %v", err)
	}
	if cfg.ListenAddr != ":18080" || cfg.Mongo.Database != "test_trace" || cfg.Mongo.ConnectTimeout != 3*time.Second {
		t.Fatalf("overrides were not parsed: %+v", cfg)
	}
}
