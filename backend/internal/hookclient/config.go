package hookclient

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	projectConfigRelativePath = ".codex/nala-trace.env"
	userConfigRelativePath    = ".codex/nala-trace.env"
)

// ConfigFromRuntime loads explicit process values first, then an explicit
// config path, then the current project's ignored Codex config, and finally
// the user-level config shared across projects.
func ConfigFromRuntime() (Config, error) {
	workingDir, _ := os.Getwd()
	return configFromFiles(os.Getenv, workingDir, os.UserHomeDir, os.ReadFile)
}

// ConfigFromSources is split out so the runtime precedence and file parser can
// be tested without changing the real project or user configuration. It
// preserves the explicit-file behavior used by callers that provide a config
// path through CODEX_TRACE_CONFIG_FILE.
func ConfigFromSources(
	lookup func(string) string,
	homeDir func() (string, error),
	readFile func(string) ([]byte, error),
) (Config, error) {
	return configFromFiles(lookup, "", homeDir, readFile)
}

func configFromFiles(
	lookup func(string) string,
	workingDir string,
	homeDir func() (string, error),
	readFile func(string) ([]byte, error),
) (Config, error) {
	configPath := strings.TrimSpace(lookup("CODEX_TRACE_CONFIG_FILE"))
	fileValues := map[string]string{}
	if configPath != "" {
		values, err := readConfigFile(configPath, readFile)
		if err != nil {
			return Config{}, err
		}
		mergeConfigValues(fileValues, values)
	} else {
		if workingDir != "" {
			projectPath := filepath.Join(workingDir, filepath.FromSlash(projectConfigRelativePath))
			values, err := readConfigFile(projectPath, readFile)
			if err != nil {
				return Config{}, err
			}
			mergeConfigValues(fileValues, values)
		}

		home, err := homeDir()
		if err != nil {
			return Config{}, errors.New("hook client user config unavailable")
		}
		userPath := filepath.Join(home, filepath.FromSlash(userConfigRelativePath))
		values, err := readConfigFile(userPath, readFile)
		if err != nil {
			return Config{}, err
		}
		userValues := map[string]string{}
		mergeConfigValues(userValues, values)
		for key, value := range fileValues {
			userValues[key] = value
		}
		fileValues = userValues
	}

	return ConfigFromEnv(func(key string) string {
		if value := strings.TrimSpace(lookup(key)); value != "" {
			return value
		}
		return fileValues[key]
	})
}

func readConfigFile(path string, readFile func(string) ([]byte, error)) (map[string]string, error) {
	data, err := readFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, errors.New("hook client config unavailable")
	}
	values, err := parseConfigFile(data)
	if err != nil {
		return nil, err
	}
	return values, nil
}

func mergeConfigValues(destination, source map[string]string) {
	for key, value := range source {
		destination[key] = value
	}
}

func parseConfigFile(data []byte) (map[string]string, error) {
	values := make(map[string]string)
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 1024), 4<<20)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		separator := strings.IndexByte(line, '=')
		if separator <= 0 {
			return nil, fmt.Errorf("hook client user config line %d invalid", lineNumber)
		}
		key := strings.TrimSpace(line[:separator])
		if key != "CODEX_TRACE_API_URL" && key != "CODEX_TRACE_API_TOKEN" && key != "CODEX_TRACE_API_TIMEOUT" {
			continue
		}
		value, err := parseConfigValue(strings.TrimSpace(line[separator+1:]))
		if err != nil {
			return nil, fmt.Errorf("hook client user config line %d invalid", lineNumber)
		}
		values[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, errors.New("hook client user config unavailable")
	}
	return values, nil
}

func parseConfigValue(value string) (string, error) {
	if len(value) >= 2 && value[0] == '\'' && value[len(value)-1] == '\'' {
		return value[1 : len(value)-1], nil
	}
	if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
		parsed, err := strconv.Unquote(value)
		if err != nil {
			return "", err
		}
		return parsed, nil
	}
	return value, nil
}
