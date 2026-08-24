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

	"github.com/azhry/nala-trace/backend/internal/config"
)

var (
	ErrUnauthenticated       = errors.New("authentication rejected")
	ErrHandoffRejected       = errors.New("authentication handoff rejected")
	ErrProviderUnavailable   = errors.New("authentication provider unavailable")
	ErrMalformedProviderData = errors.New("authentication provider response invalid")
)

type IAMClient struct {
	baseURL string
	client  *http.Client
	timeout time.Duration
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
	return &IAMClient{baseURL: strings.TrimRight(cfg.NalaLabsAuthURL, "/"), client: &http.Client{Timeout: timeout}, timeout: timeout}
}

func (c *IAMClient) ValidateBearer(ctx context.Context, token string) (User, error) {
	if strings.TrimSpace(token) == "" {
		return User{}, ErrUnauthenticated
	}
	return c.requestSession(ctx, func(request *http.Request) {
		request.Header.Set("Authorization", "Bearer "+token)
	})
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

func (c *IAMClient) requestSession(ctx context.Context, authorize func(*http.Request)) (User, error) {
	if c == nil || c.client == nil || c.baseURL == "" {
		return User{}, ErrProviderUnavailable
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/auth/session", nil)
	if err != nil {
		return User{}, ErrProviderUnavailable
	}
	request.Header.Set("Accept", "application/json")
	if authorize != nil {
		authorize(request)
	}
	response, err := c.client.Do(request)
	if err != nil {
		return User{}, ErrProviderUnavailable
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return User{}, ErrProviderUnavailable
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return User{}, ErrUnauthenticated
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return User{}, ErrProviderUnavailable
	}
	user, err := decodeUser(responseBody, true)
	if err != nil {
		return User{}, err
	}
	return user, nil
}

type upstreamUser struct {
	ID           string            `json:"id"`
	UserID       string            `json:"user_id"`
	Subject      string            `json:"sub"`
	Name         string            `json:"name"`
	DisplayName  string            `json:"display_name"`
	Email        string            `json:"email"`
	Roles        []string          `json:"roles"`
	Groups       []string          `json:"groups"`
	Tags         []string          `json:"tags"`
	Admin        bool              `json:"admin"`
	Tier         string            `json:"tier"`
	Entitlements entitlementValues `json:"entitlements"`
}

type upstreamResponse struct {
	Authenticated *bool             `json:"authenticated"`
	ID            string            `json:"id"`
	UserID        string            `json:"user_id"`
	Subject       string            `json:"sub"`
	Name          string            `json:"name"`
	DisplayName   string            `json:"display_name"`
	Email         string            `json:"email"`
	Roles         []string          `json:"roles"`
	Groups        []string          `json:"groups"`
	Tags          []string          `json:"tags"`
	Admin         bool              `json:"admin"`
	Tier          string            `json:"tier"`
	Entitlements  entitlementValues `json:"entitlements"`
	User          upstreamUser      `json:"user"`
}

// entitlementValues accepts both the legacy list form and the current Nala
// Labs entitlement object. The object contains policy metadata rather than a
// stable list of names, so it is intentionally accepted without inventing
// list values for the internal user contract.
type entitlementValues []string

func (values *entitlementValues) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*values = nil
		return nil
	}

	var list []string
	if err := json.Unmarshal(data, &list); err == nil {
		*values = entitlementValues(list)
		return nil
	}

	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return err
	}
	*values = nil
	return nil
}

func decodeUser(data []byte, requireAuthenticated bool) (User, error) {
	var response upstreamResponse
	if err := json.Unmarshal(data, &response); err != nil {
		return User{}, ErrMalformedProviderData
	}
	if requireAuthenticated && (response.Authenticated == nil || !*response.Authenticated) {
		return User{}, ErrUnauthenticated
	}
	identity := response.User
	if identity.ID == "" && identity.UserID == "" && identity.Subject == "" {
		identity = upstreamUser{
			ID: response.ID, UserID: response.UserID, Subject: response.Subject,
			Name: response.Name, DisplayName: response.DisplayName, Email: response.Email,
			Roles: response.Roles, Groups: response.Groups, Tags: response.Tags,
			Admin: response.Admin, Tier: response.Tier, Entitlements: response.Entitlements,
		}
	}
	id := firstNonEmpty(identity.ID, identity.UserID, identity.Subject)
	if id == "" {
		return User{}, ErrMalformedProviderData
	}
	claims := Claims{Roles: identity.Roles, Groups: identity.Groups, Tags: identity.Tags, Admin: identity.Admin}
	tier := NormalizeTier(claims)
	if strings.EqualFold(strings.TrimSpace(identity.Tier), string(TierAdmin)) {
		tier = TierAdmin
	} else if strings.EqualFold(strings.TrimSpace(identity.Tier), string(TierDeveloper)) {
		tier = TierDeveloper
	}
	name := firstNonEmpty(identity.Name, identity.DisplayName)
	return User{ID: id, Name: name, Email: identity.Email, Tier: tier, Entitlements: append([]string(nil), identity.Entitlements...)}, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
