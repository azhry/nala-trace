package hookclient

import (
	"io/fs"
	"path/filepath"
	"testing"
	"time"
)

func TestConfigFromSourcesLoadsUserFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "nala-trace.env")
	content := []byte("# user-editable config\nCODEX_TRACE_API_URL= http://127.0.0.1:3003/ingest\nCODEX_TRACE_API_TOKEN=\"file-token\"\nCODEX_TRACE_API_TIMEOUT=2s\n")
	readFile := func(path string) ([]byte, error) {
		if path != configPath {
			t.Fatalf("read path = %q, want %q", path, configPath)
		}
		return content, nil
	}

	cfg, err := ConfigFromSources(
		func(key string) string {
			if key == "CODEX_TRACE_CONFIG_FILE" {
				return configPath
			}
			return ""
		},
		func() (string, error) { return t.TempDir(), nil },
		readFile,
	)
	if err != nil {
		t.Fatalf("ConfigFromSources() error = %v", err)
	}
	if cfg.URL != "http://127.0.0.1:3003/ingest" || cfg.Token != "file-token" || cfg.Timeout != 2*time.Second {
		t.Fatalf("ConfigFromSources() = %#v", cfg)
	}
}

func TestConfigFromSourcesProcessEnvironmentOverridesUserFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "nala-trace.env")
	lookup := func(key string) string {
		switch key {
		case "CODEX_TRACE_CONFIG_FILE":
			return configPath
		case "CODEX_TRACE_API_URL":
			return "http://process.example/ingest"
		case "CODEX_TRACE_API_TOKEN":
			return "process-token"
		}
		return ""
	}
	readFile := func(string) ([]byte, error) {
		return []byte("CODEX_TRACE_API_URL=http://file.example/ingest\nCODEX_TRACE_API_TOKEN=file-token\n"), nil
	}

	cfg, err := ConfigFromSources(lookup, func() (string, error) { return t.TempDir(), nil }, readFile)
	if err != nil {
		t.Fatalf("ConfigFromSources() error = %v", err)
	}
	if cfg.URL != "http://process.example/ingest" || cfg.Token != "process-token" {
		t.Fatalf("process environment did not override user file: %#v", cfg)
	}
}

func TestConfigFromSourcesMissingUserFileUsesEnvironment(t *testing.T) {
	lookup := func(key string) string {
		switch key {
		case "CODEX_TRACE_API_URL":
			return "http://process.example/ingest"
		case "CODEX_TRACE_API_TOKEN":
			return "process-token"
		}
		return ""
	}
	readFile := func(string) ([]byte, error) { return nil, fs.ErrNotExist }

	cfg, err := ConfigFromSources(lookup, func() (string, error) { return t.TempDir(), nil }, readFile)
	if err != nil {
		t.Fatalf("ConfigFromSources() error = %v", err)
	}
	if cfg.URL != "http://process.example/ingest" || cfg.Token != "process-token" {
		t.Fatalf("environment fallback failed: %#v", cfg)
	}
}

func TestConfigFromRuntimeSourcesUsesProjectFileBeforeUserFile(t *testing.T) {
	projectDir := t.TempDir()
	homeDir := t.TempDir()
	projectPath := filepath.Join(projectDir, ".codex", "nala-trace.env")
	userPath := filepath.Join(homeDir, ".codex", "nala-trace.env")
	files := map[string][]byte{
		projectPath: []byte("CODEX_TRACE_API_URL=http://project.example/ingest\nCODEX_TRACE_API_TOKEN=project-token\n"),
		userPath:    []byte("CODEX_TRACE_API_URL=http://user.example/ingest\nCODEX_TRACE_API_TOKEN=user-token\nCODEX_TRACE_API_TIMEOUT=5s\n"),
	}
	readFile := func(path string) ([]byte, error) {
		content, ok := files[path]
		if !ok {
			return nil, fs.ErrNotExist
		}
		return content, nil
	}

	cfg, err := configFromFiles(func(string) string { return "" }, projectDir, func() (string, error) {
		return homeDir, nil
	}, readFile)
	if err != nil {
		t.Fatalf("configFromFiles() error = %v", err)
	}
	if cfg.URL != "http://project.example/ingest" || cfg.Token != "project-token" || cfg.Timeout != 5*time.Second {
		t.Fatalf("configFromFiles() = %#v", cfg)
	}
}

func TestConfigFromRuntimeSourcesUsesUserFileWhenProjectFileIsMissing(t *testing.T) {
	projectDir := t.TempDir()
	homeDir := t.TempDir()
	userPath := filepath.Join(homeDir, ".codex", "nala-trace.env")
	readFile := func(path string) ([]byte, error) {
		if path != userPath {
			return nil, fs.ErrNotExist
		}
		return []byte("CODEX_TRACE_API_URL=http://user.example/ingest\nCODEX_TRACE_API_TOKEN=user-token\n"), nil
	}

	cfg, err := configFromFiles(func(string) string { return "" }, projectDir, func() (string, error) {
		return homeDir, nil
	}, readFile)
	if err != nil {
		t.Fatalf("configFromFiles() error = %v", err)
	}
	if cfg.URL != "http://user.example/ingest" || cfg.Token != "user-token" {
		t.Fatalf("user fallback failed: %#v", cfg)
	}
}
