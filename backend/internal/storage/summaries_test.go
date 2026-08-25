package storage

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func TestSessionSummaryJSONIncludesTitle(t *testing.T) {
	encoded, err := json.Marshal(SessionSummary{SessionID: "session-1", Title: "Inspect the trace", FileReadCount: 2})
	if err != nil {
		t.Fatalf("marshal summary: %v", err)
	}

	var fields map[string]any
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if got, want := fields["title"], "Inspect the trace"; got != want {
		t.Fatalf("title = %#v, want %q", got, want)
	}
	if got, want := fields["file_read_count"], float64(2); got != want {
		t.Fatalf("file_read_count = %#v, want %v", got, want)
	}
}

func TestSessionSummaryPipelineDerivesAndProjectsTitle(t *testing.T) {
	pipeline := sessionSummaryPipelineForUser("user-1", 10)
	pipelineValue := make(bson.A, 0, len(pipeline))
	for _, stage := range pipeline {
		pipelineValue = append(pipelineValue, stage)
	}
	if _, err := bson.Marshal(bson.D{{Key: "pipeline", Value: pipelineValue}}); err != nil {
		t.Fatalf("marshal summary pipeline: %v", err)
	}
	if len(pipeline) != 6 {
		t.Fatalf("pipeline stages = %d, want 6", len(pipeline))
	}
	if _, ok := stageDocument(pipeline[0], "$match"); !ok {
		t.Fatalf("first stage = %#v, want owner match", pipeline[0])
	}
	if _, ok := stageDocument(pipeline[1], "$sort"); !ok {
		t.Fatalf("second stage = %#v, want chronological sort", pipeline[1])
	}

	group, ok := stageDocument(pipeline[2], "$group")
	if !ok {
		t.Fatalf("group stage = %#v", pipeline[2])
	}
	for _, field := range []string{"explicit_title_candidates", "prompt_title_candidates"} {
		if _, ok := documentField(group, field); !ok {
			t.Fatalf("group stage missing %q: %#v", field, group)
		}
	}

	project, ok := stageDocument(pipeline[3], "$project")
	if !ok {
		t.Fatalf("project stage = %#v", pipeline[3])
	}
	title, ok := documentField(project, "title")
	if !ok {
		t.Fatalf("project stage missing title: %#v", project)
	}
	if _, ok := title.(bson.D); !ok {
		t.Fatalf("title expression = %T, want bson.D", title)
	}
	serialized := fmt.Sprintf("%#v", pipeline)
	for _, expected := range []string{"$payload.tool_input", "$payload.hook_event_name", "$payload.tool_name", "file_read_count", "PreToolUse"} {
		if !strings.Contains(serialized, expected) {
			t.Fatalf("pipeline missing %q: %s", expected, serialized)
		}
	}
}

func TestSessionSummaryPipelineFallsBackToSessionID(t *testing.T) {
	expression := sessionTitleExpression()
	if len(expression) != 1 || expression[0].Key != "$let" {
		t.Fatalf("title expression = %#v, want $let", expression)
	}
	let, ok := expression[0].Value.(bson.D)
	if !ok {
		t.Fatalf("$let value = %T, want bson.D", expression[0].Value)
	}
	in, ok := documentField(let, "in")
	if !ok {
		t.Fatalf("title expression missing in clause: %#v", let)
	}
	inDocument, ok := in.(bson.D)
	if !ok || !containsKey(inDocument, "$ifNull") {
		t.Fatalf("title expression missing fallback: %#v", in)
	}
}

func stageDocument(stage bson.D, key string) (bson.D, bool) {
	value, ok := documentField(stage, key)
	if !ok {
		return nil, false
	}
	document, ok := value.(bson.D)
	return document, ok
}

func documentField(document bson.D, key string) (any, bool) {
	for _, element := range document {
		if element.Key == key {
			return element.Value, true
		}
	}
	return nil, false
}

func containsKey(document bson.D, key string) bool {
	_, ok := documentField(document, key)
	return ok
}
