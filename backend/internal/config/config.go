package config

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultListenAddr        = ":3003"
	defaultFrontendURL       = "http://localhost:5005/"
	defaultAllowedOrigin     = "http://localhost:5005"
	defaultMongoURI          = "mongodb://127.0.0.1:27017"
	defaultMongoDatabase     = "nala_trace"
	defaultNalaLabsAuthURL   = "http://127.0.0.1:8080"
	defaultPostgreSQLAddress = "127.0.0.1:5432"
	defaultRedisAddress      = "127.0.0.1:6379"
	defaultKafkaAddress      = "127.0.0.1:9092"
	defaultVaultAddr         = "http://vault.nala-labs.svc.cluster.local:8200"
	defaultVaultMount        = "secret"
	defaultVaultPath         = "nala-labs/nala-trace"
	defaultSharedVaultPath   = "nala-labs/platform"
	defaultConnectTimeout    = 5 * time.Second
	defaultPingTimeout       = 2 * time.Second
	defaultDisconnectTimeout = 5 * time.Second
	defaultShutdownTimeout   = 10 * time.Second
	defaultAuthTimeout       = 5 * time.Second
)

// Config contains only parsed runtime configuration. Secret values are held in
// memory for the owning subsystem and are never included in Error messages.
type Config struct {
	ListenAddr      string
	FrontendURL     string
	AllowedOrigin   string
	ShutdownTimeout time.Duration
	DatabaseURL     string

	Mongo  MongoConfig
	Auth   AuthConfig
	Health HealthConfig
	Vault  VaultConfig
}

type MongoConfig struct {
	Enabled           bool
	URI               string
	Database          string
	ConnectTimeout    time.Duration
	PingTimeout       time.Duration
	DisconnectTimeout time.Duration
}

type AuthConfig struct {
	NalaLabsAuthURL string
	Timeout         time.Duration
}

// HealthConfig contains non-secret dependency addresses used by /healthz.
// MongoDB's host is derived from Mongo.URI so the connection string remains
// the only Mongo configuration value that needs to be stored.
type HealthConfig struct {
	PostgreSQLAddress string
	RedisAddress      string
	KafkaAddress      string
	Timeout           time.Duration
}

type VaultConfig struct {
	Enabled  bool
	Addr     string
	KVMount  string
	KVPath   string
	Token    string
	RoleID   string
	SecretID string
}

// Load reads optional local transport files, resolves enabled Vault KV values,
// and then applies explicit process environment overrides.
func Load() (Config, error) {
	values := loadDotEnvFiles()
	processValues := make(map[string]string)
	for _, key := range knownKeys() {
		if value, ok := os.LookupEnv(key); ok {
			values[key] = value
			processValues[key] = value
		}
	}
	if err := loadVaultValues(values, processValues, &http.Client{Timeout: defaultConnectTimeout}); err != nil {
		return Config{}, err
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
		DatabaseURL:     strings.TrimSpace(values["DATABASE_URL"]),
		Mongo: MongoConfig{
			Enabled:           strings.TrimSpace(values["MONGO_URI"]) != "",
			URI:               valueOr(lookup, "MONGO_URI", defaultMongoURI),
			Database:          valueOr(lookup, "MONGO_DATABASE", defaultMongoDatabase),
			ConnectTimeout:    durationOr(lookup, "MONGO_CONNECT_TIMEOUT", defaultConnectTimeout),
			PingTimeout:       durationOr(lookup, "MONGO_PING_TIMEOUT", defaultPingTimeout),
			DisconnectTimeout: durationOr(lookup, "MONGO_DISCONNECT_TIMEOUT", defaultDisconnectTimeout),
		},
		Auth: AuthConfig{
			NalaLabsAuthURL: valueOr(lookup, "NALA_LABS_AUTH_URL", defaultNalaLabsAuthURL),
			Timeout:         durationOr(lookup, "AUTH_REQUEST_TIMEOUT", defaultAuthTimeout),
		},
		Health: HealthConfig{
			PostgreSQLAddress: valueOr(lookup, "POSTGRESQL_ADDRESS", defaultPostgreSQLAddress),
			RedisAddress:      valueOr(lookup, "REDIS_ADDRESS", defaultRedisAddress),
			KafkaAddress:      valueOr(lookup, "KAFKA_ADDRESS", defaultKafkaAddress),
			Timeout:           durationOr(lookup, "HEALTHCHECK_TIMEOUT", defaultPingTimeout),
		},
		Vault: VaultConfig{
			Enabled:  vaultEnabled(lookup),
			Addr:     valueOr(lookup, "VAULT_ADDR", defaultVaultAddr),
			KVMount:  valueOr(lookup, "VAULT_KV_MOUNT", defaultVaultMount),
			KVPath:   valueOr(lookup, "VAULT_KV_PATH", defaultVaultPath),
			Token:    values["VAULT_TOKEN"],
			RoleID:   values["VAULT_ROLE_ID"],
			SecretID: values["VAULT_SECRET_ID"],
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
		if strings.TrimSpace(cfg.Mongo.URI) == "" {
			missing = append(missing, "MONGO_URI")
		}
		if strings.TrimSpace(cfg.Mongo.Database) == "" {
			missing = append(missing, "MONGO_DATABASE")
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
	if cfg.Auth.Timeout <= 0 {
		invalid = append(invalid, "AUTH_REQUEST_TIMEOUT")
	}
	if cfg.Health.Timeout <= 0 {
		invalid = append(invalid, "HEALTHCHECK_TIMEOUT")
	}
	if cfg.Vault.Enabled {
		if strings.TrimSpace(cfg.Vault.Addr) == "" {
			missing = append(missing, "VAULT_ADDR")
		}
		if strings.TrimSpace(cfg.Vault.KVMount) == "" {
			missing = append(missing, "VAULT_KV_MOUNT")
		}
		if strings.TrimSpace(cfg.Vault.KVPath) == "" {
			missing = append(missing, "VAULT_KV_PATH")
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
		"DATABASE_URL",
		"MONGO_URI", "MONGO_DATABASE",
		"MONGO_CONNECT_TIMEOUT", "MONGO_PING_TIMEOUT", "MONGO_DISCONNECT_TIMEOUT", "NALA_LABS_AUTH_URL",
		"POSTGRESQL_ADDRESS", "REDIS_ADDRESS", "KAFKA_ADDRESS", "HEALTHCHECK_TIMEOUT", "AUTH_REQUEST_TIMEOUT", "VAULT_ENABLED", "VAULT_ADDR", "VAULT_KV_MOUNT", "VAULT_KV_PATH", "VAULT_SHARED_KV_PATH", "VAULT_TOKEN", "VAULT_ROLE_ID", "VAULT_SECRET_ID",
	}
}

func loadDotEnvFiles() map[string]string {
	values := make(map[string]string)
	cwd, err := os.Getwd()
	if err != nil {
		return values
	}
	paths := []string{
		filepath.Join(cwd, ".env"),
		filepath.Join(cwd, "backend", ".env"),
		filepath.Join(cwd, ".vault-config"),
		filepath.Join(cwd, "backend", ".vault-config"),
		filepath.Join(filepath.Dir(cwd), ".vault-config"),
	}
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

// loadVaultValues resolves the configured KV v2 record before parsing the
// runtime configuration. Vault values supply secrets and deployment values;
// explicit process environment variables remain the highest-priority source.
func loadVaultValues(values, processValues map[string]string, client *http.Client) error {
	lookup := func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
	if !vaultEnabled(lookup) {
		return nil
	}
	address := valueOr(lookup, "VAULT_ADDR", defaultVaultAddr)
	mount := valueOr(lookup, "VAULT_KV_MOUNT", defaultVaultMount)
	path := valueOr(lookup, "VAULT_KV_PATH", defaultVaultPath)
	sharedPath := valueOr(lookup, "VAULT_SHARED_KV_PATH", defaultSharedVaultPath)
	token := strings.TrimSpace(values["VAULT_TOKEN"])
	if token == "" {
		return fmt.Errorf("missing required settings: VAULT_TOKEN")
	}
	secretValues, err := readVaultKV(client, address, mount, path, token)
	if err != nil {
		return err
	}
	for key, value := range secretValues {
		if _, explicitlyConfigured := processValues[key]; !explicitlyConfigured {
			values[key] = value
		}
	}
	if strings.TrimSpace(values["DATABASE_URL"]) == "" && strings.Trim(sharedPath, "/") != strings.Trim(path, "/") {
		sharedValues, err := readVaultKV(client, address, mount, sharedPath, token)
		if err != nil {
			return err
		}
		if value := strings.TrimSpace(sharedValues["DATABASE_URL"]); value != "" {
			if _, explicitlyConfigured := processValues["DATABASE_URL"]; !explicitlyConfigured {
				values["DATABASE_URL"] = value
			}
		}
	}
	return nil
}

// vaultEnabled follows the shared Nala Labs runtime contract: a configured
// Vault address is the activation signal. VAULT_ENABLED remains a backwards-
// compatible fallback for callers that construct an environment map without
// the transport settings.
func vaultEnabled(lookup func(string) (string, bool)) bool {
	if strings.TrimSpace(valueOr(lookup, "VAULT_ADDR", "")) != "" {
		return true
	}
	return boolOr(lookup, "VAULT_ENABLED", false)
}

func readVaultKV(client *http.Client, address, mount, path, token string) (map[string]string, error) {
	if client == nil {
		client = http.DefaultClient
	}
	parsedAddress, err := url.Parse(strings.TrimSpace(address))
	if err != nil || parsedAddress.Scheme == "" || parsedAddress.Host == "" {
		return nil, fmt.Errorf("invalid VAULT_ADDR")
	}
	mount = strings.Trim(mount, "/")
	path = strings.Trim(path, "/")
	if mount == "" || path == "" || strings.Contains(mount, "..") || strings.Contains(path, "..") {
		return nil, fmt.Errorf("invalid Vault KV path")
	}
	requestURL := strings.TrimRight(address, "/") + "/v1/" + mount + "/data/" + path
	request, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create Vault request: %w", err)
	}
	request.Header.Set("X-Vault-Token", token)
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("send Vault request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, response.Body)
		return nil, fmt.Errorf("Vault request returned HTTP %d", response.StatusCode)
	}
	var payload struct {
		Data struct {
			Data map[string]string `json:"data"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode Vault response: %w", err)
	}
	return payload.Data.Data, nil
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
