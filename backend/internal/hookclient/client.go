package hookclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Config struct {
	URL     string
	Token   string
	Timeout time.Duration
}

func ConfigFromEnv(lookup func(string) string) (Config, error) {
	url := strings.TrimSpace(lookup("CODEX_TRACE_API_URL"))
	token := strings.TrimSpace(lookup("CODEX_TRACE_API_TOKEN"))
	if url == "" || token == "" {
		return Config{}, errors.New("hook client configuration unavailable")
	}
	timeout := 2 * time.Second
	if raw := strings.TrimSpace(lookup("CODEX_TRACE_API_TIMEOUT")); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil || parsed <= 0 {
			return Config{}, errors.New("hook client timeout invalid")
		}
		timeout = parsed
	}
	return Config{URL: url, Token: token, Timeout: timeout}, nil
}

func Send(ctx context.Context, input io.Reader, cfg Config) error {
	payload, err := readOneJSON(input)
	if err != nil {
		return err
	}
	payload = enrichWithTranscriptUsage(ctx, payload)
	if strings.TrimSpace(cfg.URL) == "" || strings.TrimSpace(cfg.Token) == "" || cfg.Timeout <= 0 {
		return errors.New("hook client configuration unavailable")
	}
	requestCtx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, cfg.URL, strings.NewReader(string(payload)))
	if err != nil {
		return errors.New("hook client request invalid")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-Nala-Labs-API-Key", cfg.Token)
	response, err := (&http.Client{}).Do(request)
	if err != nil {
		return errors.New("hook client request failed")
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("hook client server status %d", response.StatusCode)
	}
	return nil
}

func readOneJSON(input io.Reader) ([]byte, error) {
	decoder := json.NewDecoder(io.LimitReader(input, 4<<20))
	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		return nil, errors.New("hook client input invalid")
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return nil, errors.New("hook client input must be an object")
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, errors.New("hook client input must contain one JSON value")
	}
	return raw, nil
}
