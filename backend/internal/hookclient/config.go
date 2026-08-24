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

const userConfigRelativePath = ".codex/nala-trace.env"

// ConfigFromRuntime loads explicit process values first, then falls back to a
// user-editable Codex configuration file. The file is deliberately outside
// the repository so a local API key is never part of hooks.json or source.
func ConfigFromRuntime() (Config, error) {
	return ConfigFromSources(os.Getenv, os.UserHomeDir, os.ReadFile)
}

// ConfigFromSources is split out so the runtime precedence and file parser can
// be tested without changing the real user configuration.
func ConfigFromSources(
	lookup func(string) string,
	homeDir func() (string, error),
	readFile func(string) ([]byte, error),
) (Config, error) {
	configPath := strings.TrimSpace(lookup("CODEX_TRACE_CONFIG_FILE"))
	if configPath == "" {
		home, err := homeDir()
		if err != nil {
			return Config{}, errors.New("hook client user config unavailable")
		}
		configPath = filepath.Join(home, filepath.FromSlash(userConfigRelativePath))
	}

	fileValues := map[string]string{}
	data, err := readFile(configPath)
	if err == nil {
		fileValues, err = parseConfigFile(data)
		if err != nil {
			return Config{}, err
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return Config{}, errors.New("hook client user config unavailable")
	}

	return ConfigFromEnv(func(key string) string {
		if value := strings.TrimSpace(lookup(key)); value != "" {
			return value
		}
		return fileValues[key]
	})
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
