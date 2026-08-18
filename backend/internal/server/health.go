package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/azhry/nala-trace/backend/internal/config"
)

const defaultHealthProbeTimeout = 2 * time.Second

const (
	healthStatusOK            = "ok"
	healthStatusDegraded      = "degraded"
	healthStatusUnavailable   = "unavailable"
	healthStatusNotConfigured = "not_configured"
)

type healthDependency struct {
	Status string `json:"status"`
}

type healthResponse struct {
	Status       string                      `json:"status"`
	Dependencies map[string]healthDependency `json:"dependencies"`
}

var healthDependencyNames = []string{
	"casdoor",
	"vault",
	"postgresql",
	"mongodb",
	"redis",
	"kafka",
}

type healthProbe func(context.Context) error

// HealthChecker runs bounded probes for all dependencies in the sibling
// health contract. Probes are injectable so the HTTP contract can be tested
// without requiring platform services.
type HealthChecker struct {
	probes   map[string]healthProbe
	optional map[string]bool
	timeout  time.Duration
}

// NewHealthChecker wires probes to the shared Nala Labs auth service, Vault,
// the initialized Mongo store, and the configured platform TCP addresses.
// Mongo is reported as not configured when no URI was resolved; it is never
// represented as healthy by a TCP-only fallback.
func NewHealthChecker(cfg config.Config, mongoProbe func(context.Context) error) *HealthChecker {
	var mongoHealth healthProbe
	optional := map[string]bool{}
	if mongoProbe != nil {
		mongoHealth = mongoProbe
	} else if cfg.Mongo.Enabled {
		mongoHealth = func(context.Context) error {
			return errors.New("mongo store not initialized")
		}
	} else {
		optional["mongodb"] = true
	}

	timeout := cfg.Health.Timeout
	if timeout <= 0 {
		timeout = defaultHealthProbeTimeout
	}
	var vaultHealth healthProbe
	if cfg.Vault.Enabled {
		vaultHealth = httpHealthProbe(cfg.Vault.Addr, "/v1/sys/health")
	} else {
		optional["vault"] = true
	}
	return &HealthChecker{
		probes: map[string]healthProbe{
			"casdoor":    httpHealthProbe(cfg.Auth.NalaLabsAuthURL, "/healthz"),
			"vault":      vaultHealth,
			"postgresql": tcpHealthProbe(cfg.Health.PostgreSQLAddress),
			"mongodb":    mongoHealth,
			"redis":      tcpHealthProbe(cfg.Health.RedisAddress),
			"kafka":      tcpHealthProbe(cfg.Health.KafkaAddress),
		},
		optional: optional,
		timeout:  timeout,
	}
}

func (h *HealthChecker) check(ctx context.Context) healthResponse {
	if h == nil {
		return healthResponse{Status: healthStatusDegraded, Dependencies: siblingHealthDependencies()}
	}
	timeout := h.timeout
	if timeout <= 0 {
		timeout = defaultHealthProbeTimeout
	}
	statuses := make([]healthDependency, len(healthDependencyNames))
	var waitGroup sync.WaitGroup
	for index, name := range healthDependencyNames {
		waitGroup.Add(1)
		go func(index int, probe healthProbe) {
			defer waitGroup.Done()
			if probe == nil {
				statuses[index] = healthDependency{Status: healthStatusNotConfigured}
				return
			}
			probeCtx, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()
			if err := probe(probeCtx); err != nil {
				statuses[index] = healthDependency{Status: healthStatusUnavailable}
				return
			}
			statuses[index] = healthDependency{Status: healthStatusOK}
		}(index, h.probes[name])
	}
	waitGroup.Wait()

	dependencies := make(map[string]healthDependency, len(healthDependencyNames))
	allHealthy := true
	for index, name := range healthDependencyNames {
		dependencies[name] = statuses[index]
		if statuses[index].Status != healthStatusOK && !(statuses[index].Status == healthStatusNotConfigured && h.optional[name]) {
			allHealthy = false
		}
	}
	status := healthStatusDegraded
	if allHealthy {
		status = healthStatusOK
	}
	return healthResponse{Status: status, Dependencies: dependencies}
}

func httpHealthProbe(baseAddress, suffix string) healthProbe {
	if strings.TrimSpace(baseAddress) == "" {
		return nil
	}
	return func(ctx context.Context) error {
		probeURL, err := appendHealthPath(baseAddress, suffix)
		if err != nil {
			return err
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, probeURL, nil)
		if err != nil {
			return err
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			return err
		}
		defer response.Body.Close()
		_, _ = io.Copy(io.Discard, response.Body)
		if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
			return fmt.Errorf("health probe returned HTTP %d", response.StatusCode)
		}
		return nil
	}
}

func tcpHealthProbe(address string) healthProbe {
	if strings.TrimSpace(address) == "" {
		return nil
	}
	return func(ctx context.Context) error {
		connection, err := (&net.Dialer{}).DialContext(ctx, "tcp", address)
		if err != nil {
			return err
		}
		return connection.Close()
	}
}

func appendHealthPath(baseAddress, suffix string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(baseAddress))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		if err == nil {
			err = fmt.Errorf("health address must include a scheme and host")
		}
		return "", err
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + suffix
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func siblingHealthDependencies() map[string]healthDependency {
	dependencies := make(map[string]healthDependency, len(healthDependencyNames))
	for _, name := range healthDependencyNames {
		dependencies[name] = healthDependency{Status: healthStatusNotConfigured}
	}
	return dependencies
}

func HealthRoute(checkers ...*HealthChecker) Route {
	var checker *HealthChecker
	if len(checkers) > 0 {
		checker = checkers[0]
	}
	return Route{
		Pattern: "/healthz",
		Handler: http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
			response := healthResponse{Status: healthStatusDegraded, Dependencies: siblingHealthDependencies()}
			if checker != nil {
				response = checker.check(request.Context())
			}
			statusCode := http.StatusServiceUnavailable
			if response.Status == healthStatusOK {
				statusCode = http.StatusOK
			}
			WriteJSON(w, statusCode, response)
		}),
	}
}
