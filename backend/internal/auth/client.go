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
	ErrProviderUnavailable   = errors.New("authentication provider unavailable")
	ErrMalformedProviderData = errors.New("authentication provider response invalid")
)

type IAMClient struct {
	baseURL string
	client  *http.Client
	timeout time.Duration
}

func NewIAMClient(cfg config.AuthConfig) *IAMClient {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &IAMClient{baseURL: strings.TrimRight(cfg.NalaLabsAuthURL, "/"), client: &http.Client{Timeout: timeout}, timeout: timeout}
}

func (c *IAMClient) Login(ctx context.Context, username, password string) (User, error) {
	if strings.TrimSpace(username) == "" || password == "" {
		return User{}, ErrUnauthenticated
	}
	body, err := json.Marshal(map[string]string{"username": username, "password": password})
	if err != nil {
		return User{}, ErrProviderUnavailable
	}
	return c.requestUser(ctx, http.MethodPost, "/api/auth/login", body, "")
}

func (c *IAMClient) ValidateBearer(ctx context.Context, token string) (User, error) {
	if strings.TrimSpace(token) == "" {
		return User{}, ErrUnauthenticated
	}
	return c.requestUser(ctx, http.MethodGet, "/api/auth/session", nil, token)
}

func (c *IAMClient) Callback(ctx context.Context, code string) (User, error) {
	if strings.TrimSpace(code) == "" {
		return User{}, ErrUnauthenticated
	}
	return c.requestUser(ctx, http.MethodGet, "/api/auth/callback?code="+url.QueryEscape(code), nil, "")
}

func (c *IAMClient) requestUser(ctx context.Context, method, path string, body []byte, token string) (User, error) {
	if c == nil || c.client == nil || c.baseURL == "" {
		return User{}, ErrProviderUnavailable
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return User{}, ErrProviderUnavailable
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
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
	user, err := decodeUser(responseBody, token != "")
	if err != nil {
		return User{}, err
	}
	return user, nil
}

type upstreamUser struct {
	ID           string   `json:"id"`
	UserID       string   `json:"user_id"`
	Subject      string   `json:"sub"`
	Name         string   `json:"name"`
	DisplayName  string   `json:"display_name"`
	Email        string   `json:"email"`
	Roles        []string `json:"roles"`
	Groups       []string `json:"groups"`
	Tags         []string `json:"tags"`
	Admin        bool     `json:"admin"`
	Tier         string   `json:"tier"`
	Entitlements []string `json:"entitlements"`
}

type upstreamResponse struct {
	Authenticated *bool        `json:"authenticated"`
	ID            string       `json:"id"`
	UserID        string       `json:"user_id"`
	Subject       string       `json:"sub"`
	Name          string       `json:"name"`
	DisplayName   string       `json:"display_name"`
	Email         string       `json:"email"`
	Roles         []string     `json:"roles"`
	Groups        []string     `json:"groups"`
	Tags          []string     `json:"tags"`
	Admin         bool         `json:"admin"`
	Tier          string       `json:"tier"`
	Entitlements  []string     `json:"entitlements"`
	User          upstreamUser `json:"user"`
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
