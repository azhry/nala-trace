package config

import (
	"net/url"
	"strings"
	"testing"
)

func TestLoadFromOverridesMongoHostAndPreservesURIOptions(t *testing.T) {
	const mongoURI = "mongodb://nala-user:do-not-leak@mongodb.nala-labs.svc.cluster.local:27017/nala_trace?authSource=admin&replicaSet=rs0"
	cfg, err := LoadFrom(map[string]string{
		"MONGO_URI":  mongoURI,
		"MONGO_HOST": "127.0.0.1:27018",
	})
	if err != nil {
		t.Fatalf("LoadFrom returned an error: %v", err)
	}

	parsed, err := url.Parse(cfg.Mongo.URI)
	if err != nil {
		t.Fatalf("parse resolved Mongo URI: %v", err)
	}
	if parsed.Host != "127.0.0.1:27018" {
		t.Fatalf("Mongo host = %q, want 127.0.0.1:27018", parsed.Host)
	}
	if parsed.User == nil || parsed.User.Username() != "nala-user" {
		t.Fatalf("Mongo username was not preserved")
	}
	if password, ok := parsed.User.Password(); !ok || password != "do-not-leak" {
		t.Fatalf("Mongo password was not preserved")
	}
	if parsed.Path != "/nala_trace" {
		t.Fatalf("Mongo database path = %q, want /nala_trace", parsed.Path)
	}
	if parsed.RawQuery != "authSource=admin&replicaSet=rs0" {
		t.Fatalf("Mongo query = %q, want authSource and replicaSet options unchanged", parsed.RawQuery)
	}
}

func TestLoadFromRejectsInvalidMongoHostWithoutLeakingURI(t *testing.T) {
	const password = "do-not-leak"
	for _, host := range []string{"localhost", "localhost:0", "localhost:27018/path", "mongodb://user:password@localhost:27018", "mongodb.nala-labs.svc.cluster.local:27018"} {
		t.Run(host, func(t *testing.T) {
			_, err := LoadFrom(map[string]string{
				"MONGO_URI":  "mongodb://nala-user:" + password + "@mongodb.nala-labs.svc.cluster.local:27017/nala_trace",
				"MONGO_HOST": host,
			})
			if err == nil || !strings.Contains(err.Error(), "MONGO_HOST") {
				t.Fatalf("error = %v, want safe MONGO_HOST validation error", err)
			}
			if strings.Contains(err.Error(), password) {
				t.Fatal("validation error exposed Mongo URI credentials")
			}
		})
	}
}

func TestLoadFromOverridesPostgresHostAndPreservesURIOptions(t *testing.T) {
	const databaseURL = "postgres://nala-user:test-only-password@postgresql.nala-labs.svc.cluster.local:5432/app?sslmode=require&application_name=nala-trace"
	cfg, err := LoadFrom(map[string]string{
		"DATABASE_URL":  databaseURL,
		"DATABASE_HOST": "127.0.0.1:25432",
	})
	if err != nil {
		t.Fatalf("LoadFrom returned an error: %v", err)
	}

	parsed, err := url.Parse(cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("parse resolved PostgreSQL URL: %v", err)
	}
	if parsed.Host != "127.0.0.1:25432" {
		t.Fatalf("PostgreSQL host = %q, want 127.0.0.1:25432", parsed.Host)
	}
	if parsed.User == nil || parsed.User.Username() != "nala-user" {
		t.Fatalf("PostgreSQL username was not preserved")
	}
	if password, ok := parsed.User.Password(); !ok || password != "test-only-password" {
		t.Fatalf("PostgreSQL password was not preserved")
	}
	if parsed.Path != "/app" {
		t.Fatalf("PostgreSQL database path = %q, want /app", parsed.Path)
	}
	if parsed.RawQuery != "sslmode=require&application_name=nala-trace" {
		t.Fatalf("PostgreSQL query = %q, want connection options unchanged", parsed.RawQuery)
	}
	if cfg.Health.PostgreSQLAddress != "127.0.0.1:25432" {
		t.Fatalf("PostgreSQL health address = %q, want 127.0.0.1:25432", cfg.Health.PostgreSQLAddress)
	}
}

func TestLoadFromRejectsInvalidPostgresHostWithoutLeakingURI(t *testing.T) {
	const password = "test-only-password"
	for _, host := range []string{"localhost", "localhost:0", "localhost:25432/path", "postgres://user:password@localhost:25432", "postgresql.nala-labs.svc.cluster.local:25432"} {
		t.Run(host, func(t *testing.T) {
			_, err := LoadFrom(map[string]string{
				"DATABASE_URL":  "postgres://nala-user:" + password + "@postgresql.nala-labs.svc.cluster.local:5432/app",
				"DATABASE_HOST": host,
			})
			if err == nil || !strings.Contains(err.Error(), "DATABASE_HOST") {
				t.Fatalf("error = %v, want safe DATABASE_HOST validation error", err)
			}
			if strings.Contains(err.Error(), password) {
				t.Fatal("validation error exposed PostgreSQL URI credentials")
			}
		})
	}
}
