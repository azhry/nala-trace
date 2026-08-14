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
	if cfg.ListenAddr != ":8080" || cfg.Mongo.URI != "mongodb://127.0.0.1:27017" {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if cfg.Mongo.Enabled {
		t.Fatal("Mongo should be disabled by default")
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
