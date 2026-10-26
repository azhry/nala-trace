package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	authsdk "github.com/azhry/nala-auth-go"
	"github.com/azhry/nala-trace/backend/internal/config"
)

var (
	ErrUnauthenticated       = errors.New("authentication rejected")
	ErrHandoffRejected       = errors.New("authentication handoff rejected")
	ErrProviderUnavailable   = errors.New("authentication provider unavailable")
	ErrMalformedProviderData = errors.New("authentication provider response invalid")
)

type IAMClient struct {
	baseURL       string
	client        *http.Client
	sessionClient *authsdk.SessionClient
}

func NormalizeTraceOrigin(value string) string {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(value))
	if err != nil || parsed.User != nil || parsed.Host == "" || !strings.EqualFold(parsed.Scheme, "http") && !strings.EqualFold(parsed.Scheme, "https") {
		return ""
	}
	if parsed.Path != "" && parsed.Path != "/" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func NewIAMClient(cfg config.AuthConfig) *IAMClient {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.NalaLabsAuthURL), "/")
	client := &http.Client{Timeout: timeout}
	return &IAMClient{
		baseURL:       baseURL,
		client:        client,
		sessionClient: authsdk.NewSessionClient(baseURL, client),
	}
}

func (c *IAMClient) ValidateBearer(ctx context.Context, token string) (User, error) {
	if strings.TrimSpace(token) == "" {
		return User{}, ErrUnauthenticated
	}
	if c == nil || c.sessionClient == nil {
		return User{}, ErrProviderUnavailable
	}
	principal, err := c.sessionClient.ValidateBearer(ctx, token)
	if err != nil {
		switch {
		case errors.Is(err, authsdk.ErrUnauthenticated):
			return User{}, ErrUnauthenticated
		case errors.Is(err, authsdk.ErrMalformedResponse):
			return User{}, ErrMalformedProviderData
		default:
			return User{}, ErrProviderUnavailable
		}
	}

	var entitlements []string
	rawEntitlements := bytes.TrimSpace(principal.Entitlements)
	if len(rawEntitlements) > 0 && rawEntitlements[0] == '[' {
		if err := json.Unmarshal(rawEntitlements, &entitlements); err != nil {
			return User{}, ErrMalformedProviderData
		}
	}
	return User{
		ID:           principal.ID,
		Name:         principal.Name,
		Email:        principal.Email,
		Tier:         traceTier(principal.Tier),
		Entitlements: entitlements,
	}, nil
}

func (c *IAMClient) RedeemTraceHandoff(ctx context.Context, code, traceOrigin string) (string, error) {
	code = strings.TrimSpace(code)
	traceOrigin = NormalizeTraceOrigin(traceOrigin)
	if code == "" || traceOrigin == "" {
		return "", ErrHandoffRejected
	}
	if c == nil || c.client == nil || c.baseURL == "" {
		return "", ErrProviderUnavailable
	}

	body, err := json.Marshal(struct {
		Code        string `json:"code"`
		TraceOrigin string `json:"trace_origin"`
	}{Code: code, TraceOrigin: traceOrigin})
	if err != nil {
		return "", ErrProviderUnavailable
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/auth/trace-handoff/redeem", bytes.NewReader(body))
	if err != nil {
		return "", ErrProviderUnavailable
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	response, err := c.client.Do(request)
	if err != nil {
		return "", ErrProviderUnavailable
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", ErrProviderUnavailable
	}
	if response.StatusCode == http.StatusBadRequest || response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return "", ErrHandoffRejected
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", ErrProviderUnavailable
	}

	var payload struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return "", ErrMalformedProviderData
	}
	token := firstNonEmpty(payload.Token, payload.AccessToken)
	if token == "" {
		return "", ErrMalformedProviderData
	}
	return strings.TrimSpace(token), nil
}

func traceTier(tier authsdk.Tier) Tier {
	switch tier {
	case authsdk.TierAdmin:
		return TierAdmin
	case authsdk.TierDeveloper:
		return TierDeveloper
	default:
		return TierFree
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
