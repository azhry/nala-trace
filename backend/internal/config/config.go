package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultListenAddr        = ":8080"
	defaultFrontendURL       = "http://localhost:5173/"
	defaultAllowedOrigin     = "http://localhost:5173"
	defaultMongoURI          = "mongodb://127.0.0.1:27017"
	defaultMongoDatabase     = "nala_trace"
	defaultNalaLabsAuthURL   = "http://127.0.0.1:18080"
	defaultCookieName        = "nala_trace_session"
	defaultSessionTTL        = 24 * time.Hour
	defaultVaultAddr         = "http://127.0.0.1:8200"
	defaultVaultMount        = "kv"
	defaultVaultPath         = "nala-trace/config"
	defaultConnectTimeout    = 5 * time.Second
	defaultPingTimeout       = 2 * time.Second
	defaultDisconnectTimeout = 5 * time.Second
	defaultShutdownTimeout   = 10 * time.Second
)

// Config contains only parsed runtime configuration. Secret values are held in
// memory for the owning subsystem and are never included in Error messages.
type Config struct {
	ListenAddr      string
	FrontendURL     string
	AllowedOrigin   string
	ShutdownTimeout time.Duration
	IngestToken     string

	Mongo   MongoConfig
	Auth    AuthConfig
	Session SessionConfig
	Vault   VaultConfig
}

type MongoConfig struct {
	Enabled           bool
	URI               string
	Database          string
	Username          string
	Password          string
	ConnectTimeout    time.Duration
	PingTimeout       time.Duration
	DisconnectTimeout time.Duration
}

type AuthConfig struct {
	NalaLabsAuthURL string
}

type SessionConfig struct {
	CookieName string
	TTL        time.Duration
	Secret     string
}

type VaultConfig struct {
	Enabled    bool
	Addr       string
	KVMount    string
	ConfigPath string
	Token      string
}

// Load reads process environment first and optional local .env files second.
// Explicit process values always win over local files.
func Load() (Config, error) {
	values := loadDotEnvFiles()
	for _, key := range knownKeys() {
		if value, ok := os.LookupEnv(key); ok {
			values[key] = value
		}
	}
	return LoadFrom(values)
}

// LoadFrom parses a deterministic environment map, which keeps configuration
// tests independent from the developer machine.
func LoadFrom(values map[string]string) (Config, error) {
	lookup := func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}

	cfg := Config{
		ListenAddr:      valueOr(lookup, "AUTH_LISTEN_ADDR", defaultListenAddr),
		FrontendURL:     valueOr(lookup, "FRONTEND_URL", defaultFrontendURL),
		AllowedOrigin:   valueOr(lookup, "AUTH_ALLOWED_ORIGIN", defaultAllowedOrigin),
		ShutdownTimeout: durationOr(lookup, "SHUTDOWN_TIMEOUT", defaultShutdownTimeout),
		IngestToken:     values["CODEX_TRACE_API_TOKEN"],
		Mongo: MongoConfig{
			Enabled:           boolOr(lookup, "MONGO_ENABLED", false),
			URI:               valueOr(lookup, "MONGO_URI", defaultMongoURI),
			Database:          valueOr(lookup, "MONGO_DATABASE", defaultMongoDatabase),
			Username:          values["MONGO_USERNAME"],
			Password:          values["MONGO_PASSWORD"],
			ConnectTimeout:    durationOr(lookup, "MONGO_CONNECT_TIMEOUT", defaultConnectTimeout),
			PingTimeout:       durationOr(lookup, "MONGO_PING_TIMEOUT", defaultPingTimeout),
			DisconnectTimeout: durationOr(lookup, "MONGO_DISCONNECT_TIMEOUT", defaultDisconnectTimeout),
		},
		Auth: AuthConfig{
			NalaLabsAuthURL: valueOr(lookup, "NALA_LABS_AUTH_URL", defaultNalaLabsAuthURL),
		},
		Session: SessionConfig{
			CookieName: valueOr(lookup, "SESSION_COOKIE_NAME", defaultCookieName),
			TTL:        durationOr(lookup, "SESSION_TTL", defaultSessionTTL),
			Secret:     values["SESSION_SECRET"],
		},
		Vault: VaultConfig{
			Enabled:    boolOr(lookup, "VAULT_ENABLED", false),
			Addr:       valueOr(lookup, "VAULT_ADDR", defaultVaultAddr),
			KVMount:    valueOr(lookup, "VAULT_KV_MOUNT", defaultVaultMount),
			ConfigPath: valueOr(lookup, "VAULT_CONFIG_PATH", defaultVaultPath),
			Token:      values["VAULT_TOKEN"],
		},
	}

	return cfg, validate(cfg, values, lookup)
}

func validate(cfg Config, values map[string]string, lookup func(string) (string, bool)) error {
	var invalid []string
	var missing []string

	if cfg.ListenAddr == "" {
		missing = append(missing, "AUTH_LISTEN_ADDR")
	}
	if _, err := url.ParseRequestURI(cfg.FrontendURL); err != nil || !strings.HasPrefix(cfg.FrontendURL, "http") {
		invalid = append(invalid, "FRONTEND_URL")
	}
	if _, err := url.ParseRequestURI(cfg.AllowedOrigin); err != nil || !strings.HasPrefix(cfg.AllowedOrigin, "http") {
		invalid = append(invalid, "AUTH_ALLOWED_ORIGIN")
	}
	if cfg.ShutdownTimeout <= 0 {
		invalid = append(invalid, "SHUTDOWN_TIMEOUT")
	}

	if cfg.Mongo.Enabled {
		for _, key := range []string{"MONGO_URI", "MONGO_DATABASE"} {
			if strings.TrimSpace(values[key]) == "" {
				missing = append(missing, key)
			}
		}
		if cfg.Mongo.ConnectTimeout <= 0 {
			invalid = append(invalid, "MONGO_CONNECT_TIMEOUT")
		}
		if cfg.Mongo.PingTimeout <= 0 {
			invalid = append(invalid, "MONGO_PING_TIMEOUT")
		}
		if cfg.Mongo.DisconnectTimeout <= 0 {
			invalid = append(invalid, "MONGO_DISCONNECT_TIMEOUT")
		}
	}

	if _, err := url.ParseRequestURI(cfg.Auth.NalaLabsAuthURL); err != nil || !strings.HasPrefix(cfg.Auth.NalaLabsAuthURL, "http") {
		invalid = append(invalid, "NALA_LABS_AUTH_URL")
	}
	if cfg.Session.CookieName == "" {
		missing = append(missing, "SESSION_COOKIE_NAME")
	}
	if cfg.Session.TTL <= 0 {
		invalid = append(invalid, "SESSION_TTL")
	}
	if cfg.Vault.Enabled {
		for _, key := range []string{"VAULT_ADDR", "VAULT_KV_MOUNT", "VAULT_CONFIG_PATH"} {
			if strings.TrimSpace(values[key]) == "" {
				missing = append(missing, key)
			}
		}
	}

	if len(missing) > 0 || len(invalid) > 0 {
		return &ValidationError{Missing: missing, Invalid: invalid}
	}
	return nil
}

type ValidationError struct {
	Missing []string
	Invalid []string
}

func (e *ValidationError) Error() string {
	parts := make([]string, 0, 2)
	if len(e.Missing) > 0 {
		parts = append(parts, "missing required settings: "+strings.Join(e.Missing, ", "))
	}
	if len(e.Invalid) > 0 {
		parts = append(parts, "invalid settings: "+strings.Join(e.Invalid, ", "))
	}
	return strings.Join(parts, "; ")
}

func Redact(value string) string {
	if value == "" {
		return value
	}
	if parsed, err := url.Parse(value); err == nil && parsed.User != nil {
		parsed.User = url.UserPassword(parsed.User.Username(), "[REDACTED]")
		return parsed.String()
	}
	return value
}

func knownKeys() []string {
	return []string{
		"AUTH_LISTEN_ADDR", "FRONTEND_URL", "AUTH_ALLOWED_ORIGIN", "SHUTDOWN_TIMEOUT",
		"CODEX_TRACE_API_TOKEN", "MONGO_ENABLED", "MONGO_URI", "MONGO_DATABASE", "MONGO_USERNAME", "MONGO_PASSWORD",
		"MONGO_CONNECT_TIMEOUT", "MONGO_PING_TIMEOUT", "MONGO_DISCONNECT_TIMEOUT", "NALA_LABS_AUTH_URL", "SESSION_COOKIE_NAME",
		"SESSION_TTL", "SESSION_SECRET", "VAULT_ENABLED", "VAULT_ADDR", "VAULT_KV_MOUNT", "VAULT_CONFIG_PATH", "VAULT_TOKEN",
	}
}

func loadDotEnvFiles() map[string]string {
	values := make(map[string]string)
	cwd, err := os.Getwd()
	if err != nil {
		return values
	}
	paths := []string{filepath.Join(cwd, ".env"), filepath.Join(cwd, "backend", ".env")}
	for _, path := range paths {
		fileValues, err := parseDotEnv(path)
		if err == nil {
			for key, value := range fileValues {
				if _, exists := values[key]; !exists {
					values[key] = value
				}
			}
		}
	}
	return values
}

func parseDotEnv(path string) (map[string]string, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	values := make(map[string]string)
	for lineNumber, line := range strings.Split(string(contents), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok || strings.TrimSpace(key) == "" {
			return nil, fmt.Errorf("invalid .env entry at line %d", lineNumber+1)
		}
		values[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), "\"'")
	}
	return values, nil
}

func valueOr(lookup func(string) (string, bool), key, fallback string) string {
	if value, ok := lookup(key); ok {
		return strings.TrimSpace(value)
	}
	return fallback
}

func boolOr(lookup func(string) (string, bool), key string, fallback bool) bool {
	value, ok := lookup(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	return parsed
}

func durationOr(lookup func(string) (string, bool), key string, fallback time.Duration) time.Duration {
	value, ok := lookup(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(strings.TrimSpace(value))
	if err != nil {
		return 0
	}
	return parsed
}
