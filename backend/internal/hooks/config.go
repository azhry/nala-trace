package hooks

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"

	"github.com/azhry/nala-trace/backend/internal/events"
)

type Hook struct {
	Command []string `json:"command"`
	Stdin   string   `json:"stdin"`
}

type Manifest struct {
	Version   int             `json:"version"`
	Hooks     map[string]Hook `json:"hooks"`
	KnownGaps []string        `json:"known_gaps"`
}

func LoadFile(path string) (Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Manifest{}, fmt.Errorf("read hook manifest: %w", err)
	}
	return Parse(data)
}

func Parse(data []byte) (Manifest, error) {
	root, err := decodeUniqueObject(data)
	if err != nil {
		return Manifest{}, errors.New("hook manifest must be a JSON object with unique keys")
	}
	var manifest Manifest
	if raw := root["version"]; len(raw) > 0 {
		if err := json.Unmarshal(raw, &manifest.Version); err != nil {
			return Manifest{}, errors.New("hook manifest version is invalid")
		}
	}
	hooksRaw, ok := root["hooks"]
	if !ok {
		return Manifest{}, errors.New("hook manifest hooks are required")
	}
	hookValues, err := decodeUniqueObject(hooksRaw)
	if err != nil {
		return Manifest{}, errors.New("hook manifest hooks must be an object with unique keys")
	}
	manifest.Hooks = make(map[string]Hook, len(hookValues))
	for name, raw := range hookValues {
		var hook Hook
		if err := json.Unmarshal(raw, &hook); err != nil {
			return Manifest{}, fmt.Errorf("hook %s is invalid", name)
		}
		manifest.Hooks[name] = hook
	}
	if raw := root["known_gaps"]; len(raw) > 0 {
		if err := json.Unmarshal(raw, &manifest.KnownGaps); err != nil {
			return Manifest{}, errors.New("hook manifest known_gaps is invalid")
		}
	}
	if err := Validate(manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func Validate(manifest Manifest) error {
	if manifest.Version != 1 {
		return errors.New("hook manifest version must be 1")
	}
	wanted := events.SupportedEventNames()
	if len(manifest.Hooks) != len(wanted) {
		return fmt.Errorf("hook manifest must register exactly %d events", len(wanted))
	}
	for _, name := range wanted {
		hook, ok := manifest.Hooks[name]
		if !ok {
			return fmt.Errorf("hook manifest missing event %s", name)
		}
		if len(hook.Command) != 1 || hook.Command[0] != "hook-client" {
			return fmt.Errorf("hook %s must invoke hook-client", name)
		}
		if hook.Stdin != "json" {
			return fmt.Errorf("hook %s must receive JSON stdin", name)
		}
	}
	known := map[string]bool{"unified_exec": false, "WebSearch": false}
	for _, gap := range manifest.KnownGaps {
		if _, ok := known[gap]; ok {
			known[gap] = true
		}
	}
	for gap, present := range known {
		if !present {
			return fmt.Errorf("hook manifest must document known gap %s", gap)
		}
	}
	return nil
}

func decodeUniqueObject(data []byte) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return nil, errors.New("not an object")
	}
	result := make(map[string]json.RawMessage)
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		key, ok := keyToken.(string)
		if !ok {
			return nil, errors.New("object key is not a string")
		}
		if _, exists := result[key]; exists {
			return nil, fmt.Errorf("duplicate key %s", key)
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		result[key] = value
	}
	if _, err := decoder.Token(); err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		if err == nil {
			return nil, errors.New("trailing JSON value")
		}
		return nil, err
	}
	return result, nil
}

func EventNames(manifest Manifest) []string {
	result := make([]string, 0, len(manifest.Hooks))
	for name := range manifest.Hooks {
		result = append(result, name)
	}
	sort.Strings(result)
	return result
}
