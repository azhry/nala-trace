package reconstruction

import (
	"bytes"
	"encoding/json"
	"sort"
	"strings"

	"github.com/azhry/nala-trace/backend/internal/storage"
	"github.com/azhry/nala-trace/backend/internal/trace"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/bsontype"
)

type SessionSummaryFeatures struct {
	Title                string
	MCPCallCount         int64
	MCPServers           []string
	SkillInvocationCount int64
	FileOperationCount   int64
	FileReadCount        int64
	TokenUsage           trace.TokenUsage
}

type SessionSummaryAccumulator struct {
	explicitTitle        string
	promptTitle          string
	mcpServers           map[string]struct{}
	mcpCallCount         int64
	skillInvocationCount int64
	fileOperationCount   int64
	fileReadCount        int64
	tokenUsage           trace.TokenUsage
	cumulativeUsage      *trace.TokenUsage
}

func NewSessionSummaryAccumulator() *SessionSummaryAccumulator {
	return &SessionSummaryAccumulator{mcpServers: make(map[string]struct{})}
}

func (accumulator *SessionSummaryAccumulator) Add(event storage.HookEvent) {
	if accumulator == nil {
		return
	}
	document := payloadDocument(event.Payload)
	if accumulator.explicitTitle == "" {
		for _, field := range []string{"title", "session_title", "thread_title"} {
			if title, ok := directStringField(document, field); ok {
				accumulator.explicitTitle = title
				break
			}
		}
	}
	if accumulator.promptTitle == "" {
		accumulator.promptTitle, _ = directStringField(document, "prompt")
	}

	if event.HookEventName == "PreToolUse" {
		accumulator.addPreToolFeatures(event, document, toolInputDocumentFromDocument(document))
	}

	if evidence, ok := tokenUsageEvidenceFromDocument(document); ok {
		if evidence.cumulative {
			usage := evidence.usage
			accumulator.cumulativeUsage = &usage
		} else if accumulator.cumulativeUsage == nil {
			accumulator.tokenUsage.Add(evidence.usage)
		}
	}
}

func (accumulator *SessionSummaryAccumulator) AddPreToolFeature(event storage.HookEvent) {
	if accumulator == nil || event.HookEventName != "PreToolUse" {
		return
	}
	document, input := summaryFeaturePayload(event.Payload)
	if (event.ToolName == nil || strings.TrimSpace(*event.ToolName) == "") && document != nil {
		if toolName, ok := directStringField(document, "tool_name"); ok {
			event.ToolName = &toolName
		}
	}
	accumulator.addPreToolFeatures(event, document, input)
}

func summaryFeaturePayload(payload bson.Raw) (map[string]any, map[string]any) {
	if len(payload) == 0 {
		return nil, nil
	}
	raw := bson.Raw(payload)
	toolInput := raw.Lookup("tool_input")
	if toolInput.Type != bsontype.EmbeddedDocument {
		fullDocument := payloadDocument(payload)
		return fullDocument, toolInputDocumentFromDocument(fullDocument)
	}
	for _, wrapper := range []string{"payload", "raw", "data", "event"} {
		if raw.Lookup(wrapper).Type != 0 {
			fullDocument := payloadDocument(payload)
			return fullDocument, toolInputDocumentFromDocument(fullDocument)
		}
	}
	document := summaryDecodeSelectedFields(raw, summaryPayloadFeatureFields, 0)
	input := summaryDecodeSelectedFields(toolInput.Document(), summaryToolInputFeatureFields, 0)
	if summaryPatchText(input) == "" && bytes.Contains(toolInput.Value, []byte("*** Begin Patch")) {
		var fullInput bson.M
		if err := bson.Unmarshal(toolInput.Document(), &fullInput); err == nil {
			input = map[string]any(fullInput)
		}
	}
	return document, input
}

var summaryPayloadFeatureFields = featureFieldSet("tool_name", "skill_name", "skill", "skills")

var summaryToolInputFeatureFields = featureFieldSet(
	"file_path", "path", "target_file", "filename", "file", "old_path", "new_path",
	"operation", "action", "command", "cmd", "script", "patch", "patch_text", "diff",
	"name", "skill", "skill_name", "skills",
)

func featureFieldSet(fields ...string) map[string]struct{} {
	selected := make(map[string]struct{}, len(fields))
	for _, field := range fields {
		selected[field] = struct{}{}
	}
	return selected
}

func summaryDecodeSelectedFields(document bson.Raw, selected map[string]struct{}, depth int) map[string]any {
	if len(document) == 0 || depth > 3 {
		return nil
	}
	elements, err := document.Elements()
	if err != nil {
		return nil
	}
	decoded := make(map[string]any)
	for _, element := range elements {
		key := element.Key()
		value := element.Value()
		if _, ok := selected[strings.ToLower(key)]; ok {
			var result any
			if err := value.Unmarshal(&result); err == nil {
				decoded[key] = result
			}
			continue
		}
		if !isSummaryPayloadWrapper(key) {
			continue
		}
		switch value.Type {
		case bsontype.EmbeddedDocument:
			if nested := summaryDecodeSelectedFields(value.Document(), selected, depth+1); len(nested) > 0 {
				decoded[key] = nested
			}
		case bsontype.String:
			var nested map[string]any
			if err := json.Unmarshal([]byte(value.StringValue()), &nested); err == nil && nested != nil {
				if filtered := summaryFilterSelectedMap(nested, selected, depth+1); len(filtered) > 0 {
					decoded[key] = filtered
				}
			}
		}
	}
	return decoded
}

func summaryFilterSelectedMap(document map[string]any, selected map[string]struct{}, depth int) map[string]any {
	if len(document) == 0 || depth > 3 {
		return nil
	}
	filtered := make(map[string]any)
	for key, value := range document {
		if _, ok := selected[strings.ToLower(key)]; ok {
			filtered[key] = value
			continue
		}
		if !isSummaryPayloadWrapper(key) {
			continue
		}
		if nested, ok := nestedDocument(value); ok {
			if result := summaryFilterSelectedMap(nested, selected, depth+1); len(result) > 0 {
				filtered[key] = result
			}
		}
	}
	return filtered
}

func isSummaryPayloadWrapper(key string) bool {
	switch strings.ToLower(key) {
	case "payload", "raw", "data", "event":
		return true
	default:
		return false
	}
}

func (accumulator *SessionSummaryAccumulator) addPreToolFeatures(event storage.HookEvent, document, input map[string]any) {
	if server, ok := trace.MCPServerFromToolName(toolNameForEvent(event, nil)); ok {
		accumulator.mcpCallCount++
		accumulator.mcpServers[server] = struct{}{}
	}
	hasFileOperation, isFileRead, skillFileRead := summaryFileFeatureFacts(event, input)
	if hasFileOperation {
		accumulator.fileOperationCount++
	}
	if isFileRead {
		accumulator.fileReadCount++
	}
	if hasSummarySkillInvocation(event, document, input, skillFileRead) {
		accumulator.skillInvocationCount++
	}
}

func summaryFileFeatureFacts(event storage.HookEvent, input map[string]any) (hasFileOperation, isFileRead, skillFileRead bool) {
	toolName := strings.ToLower(toolNameForEvent(event, nil))
	patchText := summaryPatchText(input)
	if strings.Contains(toolName, "apply_patch") || strings.Contains(patchText, "*** Begin Patch") {
		if len(applyPatchFilePattern.FindStringSubmatch(patchText)) > 0 {
			return true, false, false
		}
	}

	paths := filePaths(input)
	command, hasCommand := stringField(input, "command", "cmd", "script")
	if len(paths) == 0 && hasCommand {
		for _, match := range commandPathPattern.FindAllStringSubmatch(command, -1) {
			path := ""
			for _, candidate := range match[1:] {
				if candidate != "" {
					path = candidate
					break
				}
			}
			if path != "" {
				paths = append(paths, path)
			}
		}
	}
	if len(paths) == 0 {
		return false, false, false
	}

	operation, _ := classifyFileOperation(toolName, input, command, hasCommand)
	isFileRead = operation == "read"
	if isFileRead {
		for _, path := range paths {
			if _, ok := skillNameFromFilePath(path); ok {
				return true, true, true
			}
		}
	}
	return true, isFileRead, false
}

func hasSummarySkillInvocation(event storage.HookEvent, document, input map[string]any, skillFileRead bool) bool {
	if _, ok := stringField(input, "skill_name", "skill"); ok {
		return true
	}
	if _, ok := stringField(document, "skill_name", "skill"); ok {
		return true
	}
	if len(skillNames(input, document)) > 0 {
		return true
	}
	if strings.Contains(strings.ToLower(toolNameForEvent(event, nil)), "skill") {
		return true
	}
	return skillFileRead
}

func summaryPatchText(input map[string]any) string {
	if patch, ok := stringField(input, "patch", "patch_text", "diff"); ok {
		return patch
	}
	return findPatchText(input)
}

func findPatchText(value any) string {
	switch typed := value.(type) {
	case string:
		if strings.Contains(typed, "*** Begin Patch") {
			return typed
		}
	case map[string]any:
		for _, nested := range typed {
			if patch := findPatchText(nested); patch != "" {
				return patch
			}
		}
	case bson.M:
		for _, nested := range typed {
			if patch := findPatchText(nested); patch != "" {
				return patch
			}
		}
	case []any:
		for _, nested := range typed {
			if patch := findPatchText(nested); patch != "" {
				return patch
			}
		}
	case bson.A:
		for _, nested := range typed {
			if patch := findPatchText(nested); patch != "" {
				return patch
			}
		}
	}
	return ""
}

func (accumulator *SessionSummaryAccumulator) Result(sessionID string) SessionSummaryFeatures {
	features := SessionSummaryFeatures{
		Title:                accumulator.explicitTitle,
		MCPCallCount:         accumulator.mcpCallCount,
		MCPServers:           make([]string, 0, len(accumulator.mcpServers)),
		SkillInvocationCount: accumulator.skillInvocationCount,
		FileOperationCount:   accumulator.fileOperationCount,
		FileReadCount:        accumulator.fileReadCount,
		TokenUsage:           accumulator.tokenUsage,
	}
	if features.Title == "" {
		features.Title = accumulator.promptTitle
	}
	if features.Title == "" {
		features.Title = sessionID
	}
	for server := range accumulator.mcpServers {
		features.MCPServers = append(features.MCPServers, server)
	}
	sort.Strings(features.MCPServers)
	if accumulator.cumulativeUsage != nil {
		features.TokenUsage = *accumulator.cumulativeUsage
	}
	return features
}

func directStringField(document map[string]any, key string) (string, bool) {
	if document == nil {
		return "", false
	}
	value, ok := document[key].(string)
	value = strings.TrimSpace(value)
	return value, ok && value != ""
}
