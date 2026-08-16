package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

const hookClientHelperEnv = "NALA_TRACE_HOOK_CLIENT_HELPER"

// TestHookClientProcessHelper is the subprocess entrypoint for the failure
// matrix below. Calling main through the test binary exercises the same
// always-zero boundary without requiring a checked-in platform-specific
// executable.
func TestHookClientProcessHelper(t *testing.T) {
	if os.Getenv(hookClientHelperEnv) != "1" {
		return
	}
	main()
}

func TestHookClientFailureMatrixAlwaysExitsZero(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		switch request.URL.Query().Get("case") {
		case "non-2xx":
			w.WriteHeader(http.StatusBadGateway)
		case "malformed":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte("{"))
		case "timeout":
			time.Sleep(250 * time.Millisecond)
		default:
			w.WriteHeader(http.StatusAccepted)
		}
	}))
	defer server.Close()

	closedServer := httptest.NewServer(http.NotFoundHandler())
	closedServerURL := closedServer.URL
	closedServer.Close()

	tests := []struct {
		name    string
		url     string
		timeout string
		input   string
	}{
		{name: "malformed input", url: server.URL, timeout: "100ms", input: "{"},
		{name: "missing configuration", input: `{"session_id":"private-session","token":"private-token"}`},
		{name: "connection failure", url: closedServerURL, timeout: "100ms", input: `{"session_id":"private-session"}`},
		{name: "non-2xx response", url: server.URL + "?case=non-2xx", timeout: "100ms", input: `{"session_id":"private-session"}`},
		{name: "malformed response", url: server.URL + "?case=malformed", timeout: "100ms", input: `{"session_id":"private-session"}`},
		{name: "timeout", url: server.URL + "?case=timeout", timeout: "25ms", input: `{"session_id":"private-session"}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			command := exec.Command(os.Args[0], "-test.run=^TestHookClientProcessHelper$")
			command.Env = append(os.Environ(), hookClientHelperEnv+"=1")
			command.Env = removeEnv(command.Env, "CODEX_TRACE_API_URL", "CODEX_TRACE_API_TOKEN", "CODEX_TRACE_API_TIMEOUT", "NALA_TRACE_HOOK_TEST_CASE")
			if test.url != "" {
				command.Env = append(command.Env,
					"CODEX_TRACE_API_URL="+test.url,
					"CODEX_TRACE_API_TOKEN=private-token",
					"CODEX_TRACE_API_TIMEOUT="+test.timeout,
				)
			}
			command.Stdin = strings.NewReader(test.input)
			var output bytes.Buffer
			command.Stdout = &output
			command.Stderr = &output

			started := time.Now()
			err := command.Run()
			if err != nil {
				t.Fatalf("hook client exited unsuccessfully: %v; output=%q", err, output.String())
			}
			// Include test-binary startup overhead; the HTTP operation itself is
			// bounded by CODEX_TRACE_API_TIMEOUT.
			if time.Since(started) > 5*time.Second {
				t.Fatalf("hook client exceeded bounded failure time: %s", time.Since(started))
			}
			if strings.Contains(output.String(), "private-token") || strings.Contains(output.String(), "private-session") {
				t.Fatalf("hook client printed sensitive data: %q", output.String())
			}
		})
	}
}

func removeEnv(values []string, names ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		remove := false
		for _, name := range names {
			if strings.HasPrefix(value, name+"=") {
				remove = true
				break
			}
		}
		if !remove {
			result = append(result, value)
		}
	}
	return result
}
