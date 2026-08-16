package hooks

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseRepositoryManifest(t *testing.T) {
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := LoadFile(filepath.Join(workingDirectory, "..", "..", "..", "hooks.json"))
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if len(manifest.Hooks) != 9 || len(manifest.KnownGaps) != 2 {
		t.Fatalf("unexpected manifest: %+v", manifest)
	}
	for _, hook := range manifest.Hooks {
		if len(hook.Command) != 1 || hook.Command[0] != "hook-client" || hook.Stdin != "json" {
			t.Fatalf("unexpected hook: %+v", hook)
		}
	}
}

func TestParseRejectsMalformedAndIncompleteManifests(t *testing.T) {
	valid := `{"version":1,"hooks":{"SessionStart":{"command":["hook-client"],"stdin":"json"},"UserPromptSubmit":{"command":["hook-client"],"stdin":"json"},"PreToolUse":{"command":["hook-client"],"stdin":"json"},"PostToolUse":{"command":["hook-client"],"stdin":"json"},"SubagentStart":{"command":["hook-client"],"stdin":"json"},"SubagentStop":{"command":["hook-client"],"stdin":"json"},"PreCompact":{"command":["hook-client"],"stdin":"json"},"PostCompact":{"command":["hook-client"],"stdin":"json"},"Stop":{"command":["hook-client"],"stdin":"json"}},"known_gaps":["unified_exec","WebSearch"]}`
	for name, input := range map[string]string{
		"malformed":           "{",
		"missing hooks":       `{"version":1}`,
		"missing event":       strings.Replace(valid, `,"Stop":{"command":["hook-client"],"stdin":"json"}`, "", 1),
		"duplicate root key":  strings.Replace(valid, `{"version":1,`, `{"version":1,"version":1,`, 1),
		"duplicate event key": strings.Replace(valid, `"SessionStart":{"command":["hook-client"],"stdin":"json"}`, `"SessionStart":{"command":["hook-client"],"stdin":"json"},"SessionStart":{"command":["hook-client"],"stdin":"json"}`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse([]byte(input)); err == nil {
				t.Fatal("Parse accepted invalid manifest")
			}
		})
	}
}
