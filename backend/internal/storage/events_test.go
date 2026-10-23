package storage

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
)

func TestHookEventIndexModelsSupportSessionSummaryRead(t *testing.T) {
	models := hookEventIndexModels()
	want := []bson.D{
		{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}},
		{{Key: "user_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}},
		{{Key: "user_id", Value: 1}, {Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}},
		{{Key: "user_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}, {Key: "session_id", Value: 1}},
		{{Key: "user_id", Value: 1}, {Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}, {Key: "hook_event_name", Value: 1}},
		{{Key: "user_id", Value: 1}, {Key: "session_id", Value: 1}, {Key: "hook_event_name", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}},
		{{Key: "user_id", Value: 1}, {Key: "session_id", Value: 1}, {Key: "payload.hook_event_name", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}},
	}
	if len(models) != len(want) {
		t.Fatalf("index model count = %d, want %d", len(models), len(want))
	}
	for index, model := range models {
		if !reflect.DeepEqual(model.Keys, want[index]) {
			t.Errorf("index %d keys = %#v, want %#v", index, model.Keys, want[index])
		}
	}
	if models[5].Options == nil || models[5].Options.Name == nil || *models[5].Options.Name != hookEventPreToolSummaryIndexName {
		t.Fatalf("PreToolUse summary index name = %#v, want %q", models[5].Options, hookEventPreToolSummaryIndexName)
	}
	if models[6].Options == nil || models[6].Options.Name == nil || *models[6].Options.Name != hookEventPayloadNameIndexName {
		t.Fatalf("payload event summary index name = %#v, want %q", models[6].Options, hookEventPayloadNameIndexName)
	}
}

func TestSummaryEventPipelineScopesAndProjectsUsageFields(t *testing.T) {
	pipeline := summaryEventPipelineForUserSessions("user-1", []string{"session-1", "session-2"})
	pipelineValue := make(bson.A, 0, len(pipeline))
	for _, stage := range pipeline {
		pipelineValue = append(pipelineValue, stage)
	}
	if _, err := bson.Marshal(bson.D{{Key: "pipeline", Value: pipelineValue}}); err != nil {
		t.Fatalf("marshal summary event pipeline: %v", err)
	}
	match, ok := stageDocument(pipeline[0], "$match")
	if !ok {
		t.Fatalf("first stage = %#v, want owner and session match", pipeline[0])
	}
	if userID, ok := documentField(match, "user_id"); !ok || userID != "user-1" {
		t.Fatalf("user match = %#v, want user-1", userID)
	}
	if _, ok := documentField(match, "session_id"); !ok {
		t.Fatalf("summary event match missing selected sessions: %#v", match)
	}
	sort, ok := stageDocument(pipeline[1], "$sort")
	if !ok || !reflect.DeepEqual(sort, bson.D{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}) {
		t.Fatalf("sort stage = %#v, want chronological session order", pipeline[1])
	}
	featureExpression, ok := documentField(match, "$expr")
	if !ok {
		t.Fatalf("summary event match missing feature predicate: %#v", match)
	}
	project, ok := stageDocument(pipeline[2], "$project")
	if !ok {
		t.Fatalf("third stage = %#v, want summary field projection", pipeline[2])
	}
	payloadProjection, ok := documentField(project, "payload")
	if !ok || payloadProjection == "$payload" {
		t.Fatalf("summary event payload projection = %#v, want selected fields", payloadProjection)
	}
	serialized := fmt.Sprintf("%#v", pipeline)
	for _, expected := range []string{"$payload.response.usage", "$payload.tool_response.usage", "$payload.title", "$payload.prompt", "$payload.tool_input.file_path", "$payload.tool_input.command", "$payload.tool_input.skill_name", "PreToolUse"} {
		if !strings.Contains(serialized, expected) {
			t.Fatalf("summary event projection missing %q", expected)
		}
	}
	if !strings.Contains(fmt.Sprintf("%#v", featureExpression), "PreToolUse") {
		t.Fatalf("summary event feature predicate missing PreToolUse: %#v", featureExpression)
	}
	if strings.Contains(fmt.Sprintf("%#v", payloadProjection), "$payload.content") {
		t.Fatalf("summary event projection must not include unbounded content: %#v", payloadProjection)
	}
}

func TestSummaryEventFindQueryScopesAndProjectsUsageFields(t *testing.T) {
	filter := summaryEventFindFilter("user-1", []string{"session-1", "session-2"})
	findOptions := summaryEventFindOptions()
	if userID, ok := documentField(filter, "user_id"); !ok || userID != "user-1" {
		t.Fatalf("summary event owner filter = %#v, want user-1", userID)
	}
	sessionFilterValue, ok := documentField(filter, "session_id")
	if !ok {
		t.Fatalf("summary event filter missing selected sessions: %#v", filter)
	}
	sessionFilter, ok := sessionFilterValue.(bson.D)
	if !ok {
		t.Fatalf("session filter = %T, want bson.D", sessionFilterValue)
	}
	selectedIDs, ok := documentField(sessionFilter, "$in")
	if !ok || !reflect.DeepEqual(selectedIDs, bson.A{"session-1", "session-2"}) {
		t.Fatalf("selected session IDs = %#v, want both requested sessions", selectedIDs)
	}
	if _, ok := documentField(filter, "$expr"); !ok {
		t.Fatalf("summary event filter missing feature predicate: %#v", filter)
	}
	wantSort := bson.D{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}
	if !reflect.DeepEqual(findOptions.Sort, wantSort) {
		t.Fatalf("summary event sort = %#v, want %#v", findOptions.Sort, wantSort)
	}
	projection, ok := findOptions.Projection.(bson.D)
	if !ok {
		t.Fatalf("summary event projection = %T, want bson.D", findOptions.Projection)
	}
	for _, field := range []string{"payload.title", "payload.prompt", "payload.tool_input.file_path", "payload.tool_input.command", "payload.tool_input.skill_name", "payload.response.usage", "payload.tool_response.usage", "payload.usage"} {
		if _, ok := documentField(projection, field); !ok {
			t.Fatalf("summary event projection missing %q", field)
		}
	}
	if _, ok := documentField(projection, "payload.content"); ok {
		t.Fatal("summary event projection includes unbounded content")
	}
	if _, err := bson.Marshal(bson.D{{Key: "filter", Value: filter}, {Key: "projection", Value: findOptions.Projection}, {Key: "sort", Value: findOptions.Sort}, {Key: "hint", Value: findOptions.Hint}}); err != nil {
		t.Fatalf("marshal summary event find query: %v", err)
	}
}

func TestSessionSummaryFeatureFindQueryUsesIndexedOwnerSessionEventScope(t *testing.T) {
	filter := summaryPreToolFeatureFindFilter("user-1", []string{"session-1", "session-2"})
	if userID, ok := documentField(filter, "user_id"); !ok || userID != "user-1" {
		t.Fatalf("feature owner filter = %#v, want user-1", userID)
	}
	if hookName, ok := documentField(filter, "hook_event_name"); !ok || hookName != "PreToolUse" {
		t.Fatalf("feature hook filter = %#v, want PreToolUse", hookName)
	}
	sessionFilterValue, ok := documentField(filter, "session_id")
	if !ok {
		t.Fatalf("feature filter missing selected sessions: %#v", filter)
	}
	sessionFilter, ok := sessionFilterValue.(bson.D)
	if !ok {
		t.Fatalf("feature session filter = %T, want bson.D", sessionFilterValue)
	}
	selectedIDs, ok := documentField(sessionFilter, "$in")
	if !ok || !reflect.DeepEqual(selectedIDs, bson.A{"session-1", "session-2"}) {
		t.Fatalf("feature selected sessions = %#v", selectedIDs)
	}
	featureExpression, ok := documentField(filter, "$expr")
	if !ok {
		t.Fatalf("feature filter missing summary feature predicate: %#v", filter)
	}
	serializedExpression := fmt.Sprintf("%#v", featureExpression)
	for _, expected := range []string{"tool_input.content", "tool_input.patch", "mcp__", "skill"} {
		if !strings.Contains(serializedExpression, expected) {
			t.Fatalf("feature predicate missing %q: %#v", expected, featureExpression)
		}
	}
	findOptions := summaryPreToolFeatureFindOptions()
	if findOptions.Hint != hookEventPreToolSummaryIndexName {
		t.Fatalf("feature query hint = %#v, want %q", findOptions.Hint, hookEventPreToolSummaryIndexName)
	}
	if findOptions.BatchSize == nil || *findOptions.BatchSize != summaryFeatureEventsBatchSize {
		t.Fatalf("feature query batch size = %#v, want %d", findOptions.BatchSize, summaryFeatureEventsBatchSize)
	}
	projection, ok := findOptions.Projection.(bson.D)
	if !ok {
		t.Fatalf("feature projection = %T, want bson.D", findOptions.Projection)
	}
	if _, ok := documentField(projection, "payload"); ok {
		t.Fatalf("feature projection includes full payload: %#v", projection)
	}
	if filePath, ok := documentField(projection, "payload.tool_input.file_path"); !ok || filePath != 1 {
		t.Fatalf("feature projection file path = %#v, want inclusion", filePath)
	}
	patchContent, ok := documentField(projection, "payload.tool_input.content")
	if !ok || patchContent != 1 {
		t.Fatalf("feature patch content projection = %#v, want inclusion", patchContent)
	}
	if _, err := bson.Marshal(bson.D{{Key: "filter", Value: filter}, {Key: "projection", Value: projection}, {Key: "hint", Value: findOptions.Hint}}); err != nil {
		t.Fatalf("marshal feature find query: %v", err)
	}
}

func TestIndexedSummaryEventQueriesSeparateCurrentAndLegacyEventNames(t *testing.T) {
	preToolFilter := summaryPreToolEventFindFilter("user-1", []string{"session-1", "session-2"})
	if eventName, ok := documentField(preToolFilter, "hook_event_name"); !ok || eventName != "PreToolUse" {
		t.Fatalf("PreToolUse event filter = %#v, want exact event name", eventName)
	}
	if _, ok := documentField(preToolFilter, "$expr"); !ok {
		t.Fatalf("PreToolUse filter missing feature predicate: %#v", preToolFilter)
	}
	conversationFilter := summaryConversationEventFindFilter("user-1", []string{"session-1"})
	eventNameFilterValue, ok := documentField(conversationFilter, "hook_event_name")
	if !ok {
		t.Fatalf("conversation filter missing event names: %#v", conversationFilter)
	}
	eventNameFilter, ok := eventNameFilterValue.(bson.D)
	if !ok {
		t.Fatalf("conversation event filter = %T, want bson.D", eventNameFilterValue)
	}
	eventNames, ok := documentField(eventNameFilter, "$in")
	if !ok || !reflect.DeepEqual(eventNames, bson.A{"UserPromptSubmit", "Stop", "SubagentStop"}) {
		t.Fatalf("conversation event types = %#v", eventNames)
	}
	if _, ok := documentField(conversationFilter, "$expr"); ok {
		t.Fatalf("conversation filter should rely on indexed event names: %#v", conversationFilter)
	}
	payloadPreToolFilter := summaryPayloadPreToolEventFindFilter("user-1", []string{"session-1"})
	payloadConversationFilter := summaryPayloadConversationEventFindFilter("user-1", []string{"session-1"})
	if _, ok := documentField(payloadPreToolFilter, "$expr"); !ok {
		t.Fatalf("legacy PreToolUse filter missing feature predicate: %#v", payloadPreToolFilter)
	}
	for _, filter := range []bson.D{payloadPreToolFilter, payloadConversationFilter} {
		missingNameValue, ok := documentField(filter, "hook_event_name")
		missingName, typed := missingNameValue.(bson.D)
		if !ok || !typed || !reflect.DeepEqual(missingName, bson.D{{Key: "$exists", Value: false}}) {
			t.Fatalf("legacy filter does not exclude top-level duplicates: %#v", filter)
		}
		if _, ok := documentField(filter, "payload.hook_event_name"); !ok {
			t.Fatalf("legacy filter missing indexed payload name: %#v", filter)
		}
	}
	if _, ok := documentField(payloadConversationFilter, "$expr"); ok {
		t.Fatalf("legacy conversation filter should rely on indexed event names: %#v", payloadConversationFilter)
	}
	if summaryPreToolEventFindOptions().Hint != hookEventPreToolSummaryIndexName {
		t.Fatalf("PreToolUse index hint = %#v", summaryPreToolEventFindOptions().Hint)
	}
	if summaryPayloadNameEventFindOptions().Hint != hookEventPayloadNameIndexName {
		t.Fatalf("payload name index hint = %#v", summaryPayloadNameEventFindOptions().Hint)
	}
	for _, conversationProjection := range []bson.D{
		summaryConversationEventFindOptions().Projection.(bson.D),
		summaryPayloadConversationEventFindOptions().Projection.(bson.D),
	} {
		if _, ok := documentField(conversationProjection, "payload.prompt"); !ok {
			t.Fatal("conversation projection missing prompt title")
		}
		promptProjection, _ := documentField(conversationProjection, "payload.prompt")
		if serialized := fmt.Sprintf("%#v", promptProjection); !strings.Contains(serialized, "$substrCP") {
			t.Fatalf("conversation prompt projection is not bounded: %#v", promptProjection)
		}
		if _, ok := documentField(conversationProjection, "payload.tool_input.command"); ok {
			t.Fatal("conversation projection should not include tool input")
		}
		usageProjection, ok := documentField(conversationProjection, "payload.input_tokens")
		if !ok || !strings.Contains(fmt.Sprintf("%#v", usageProjection), "$payload.usage.input_tokens") {
			t.Fatalf("conversation projection missing bounded token usage fields: %#v", usageProjection)
		}
	}
	findOptions := summaryPreToolEventFindOptions()
	if findOptions.Sort != nil {
		t.Fatalf("indexed summary query should leave event ordering to the merged Go result: %#v", findOptions.Sort)
	}
	projection, ok := findOptions.Projection.(bson.D)
	if !ok {
		t.Fatalf("summary query projection = %T, want bson.D", findOptions.Projection)
	}
	for _, field := range []string{"payload.hook_event_name", "payload.title", "payload.prompt", "payload.tool_input.file_path", "payload.input_tokens"} {
		if _, ok := documentField(projection, field); !ok {
			t.Fatalf("summary query projection missing %q", field)
		}
	}
	commandProjection, _ := documentField(projection, "payload.tool_input.command")
	if commandProjection != 1 {
		t.Fatalf("PreToolUse command projection = %#v, want inclusion", commandProjection)
	}
	if _, err := bson.Marshal(bson.D{{Key: "pre_tool", Value: preToolFilter}, {Key: "conversation", Value: conversationFilter}, {Key: "payload_pre_tool", Value: payloadPreToolFilter}, {Key: "payload_conversation", Value: payloadConversationFilter}, {Key: "projection", Value: findOptions.Projection}, {Key: "sort", Value: findOptions.Sort}}); err != nil {
		t.Fatalf("marshal indexed summary event queries: %v", err)
	}
}

func TestRecentSessionIDPipelineGroupsByLatestEventInOwnerScope(t *testing.T) {
	pipeline := recentSessionIDPipeline("user-1", 100)
	pipelineValue := make(bson.A, 0, len(pipeline))
	for _, stage := range pipeline {
		pipelineValue = append(pipelineValue, stage)
	}
	if _, err := bson.Marshal(bson.D{{Key: "pipeline", Value: pipelineValue}}); err != nil {
		t.Fatalf("marshal recent session pipeline: %v", err)
	}
	if len(pipeline) != 6 {
		t.Fatalf("recent session stages = %d, want 6", len(pipeline))
	}
	match, ok := stageDocument(pipeline[0], "$match")
	if !ok || !reflect.DeepEqual(match, bson.D{{Key: "user_id", Value: "user-1"}}) {
		t.Fatalf("recent session match = %#v, want owner scope", match)
	}
	sort, ok := stageDocument(pipeline[1], "$sort")
	if !ok || !reflect.DeepEqual(sort, bson.D{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}) {
		t.Fatalf("recent session input sort = %#v, want index order", sort)
	}
	group, ok := stageDocument(pipeline[2], "$group")
	if !ok || !reflect.DeepEqual(group, bson.D{
		{Key: "_id", Value: "$session_id"},
		{Key: "last_event_at", Value: bson.D{{Key: "$last", Value: "$received_at"}}},
	}) {
		t.Fatalf("recent session group = %#v, want latest event per session", group)
	}
	limit, ok := documentField(pipeline[4], "$limit")
	if !ok || limit != 100 {
		t.Fatalf("recent session limit = %#v, want 100", limit)
	}
	project, ok := stageDocument(pipeline[5], "$project")
	if !ok || !reflect.DeepEqual(project, bson.D{{Key: "_id", Value: 0}, {Key: "session_id", Value: "$_id"}}) {
		t.Fatalf("recent session projection = %#v, want only session id", project)
	}
}

func TestHookEventFromDocumentHydratesLegacyPayloadFields(t *testing.T) {
	payload, err := bson.Marshal(bson.M{
		"hook_event_name": "PreToolUse",
		"tool_name":       "skill",
		"tool_use_id":     "skill-1",
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	event := hookEventFromDocument(hookEventDocument{Payload: payload})
	if event.HookEventName != "PreToolUse" || event.ToolName == nil || *event.ToolName != "skill" || event.ToolUseID == nil || *event.ToolUseID != "skill-1" {
		t.Fatalf("hydrated event = %#v", event)
	}
}

func TestHookEventFromDocumentHydratesNestedRawPayloadFields(t *testing.T) {
	payload, err := bson.Marshal(bson.M{
		"payload": bson.M{
			"hook_event_name": "PreToolUse",
			"tool_name":       "skill",
			"tool_use_id":     "skill-1",
		},
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	event := hookEventFromDocument(hookEventDocument{Payload: payload})
	if event.HookEventName != "PreToolUse" || event.ToolName == nil || *event.ToolName != "skill" || event.ToolUseID == nil || *event.ToolUseID != "skill-1" {
		t.Fatalf("hydrated nested event = %#v", event)
	}
}

func TestListSessionEventsForUserPassesOwnerAndSessionScope(t *testing.T) {
	calledUser, calledSession := "", ""
	repository := &HookEventRepository{
		findForUser: func(_ context.Context, userID, sessionID string) ([]HookEvent, error) {
			calledUser, calledSession = userID, sessionID
			return []HookEvent{{SessionID: sessionID, UserID: userID}}, nil
		},
	}

	rows, err := repository.ListSessionEventsForUser(context.Background(), "user-1", "session-1")
	if err != nil {
		t.Fatalf("ListSessionEventsForUser() error = %v", err)
	}
	if calledUser != "user-1" || calledSession != "session-1" {
		t.Fatalf("scope = (%q, %q), want (user-1, session-1)", calledUser, calledSession)
	}
	if len(rows) != 1 || rows[0].UserID != "user-1" || rows[0].SessionID != "session-1" {
		t.Fatalf("rows = %#v", rows)
	}
}

func TestWalkSessionSummaryEventsForUserPassesOwnerAndSelectedSessions(t *testing.T) {
	var gotUser string
	var gotSessionIDs []string
	gotEvent := false
	repository := &HookEventRepository{walkSummaryEvents: func(_ context.Context, userID string, sessionIDs []string, yield func(HookEvent) error) error {
		gotUser = userID
		gotSessionIDs = append([]string(nil), sessionIDs...)
		return yield(HookEvent{UserID: userID, SessionID: sessionIDs[0], HookEventName: "PreToolUse"})
	}}
	err := repository.WalkSessionSummaryEventsForUser(context.Background(), "user-1", []string{" session-1 "}, func(event HookEvent) error {
		gotEvent = event.UserID == "user-1" && event.SessionID == "session-1" && event.HookEventName == "PreToolUse"
		return nil
	})
	if err != nil {
		t.Fatalf("WalkSessionSummaryEventsForUser() error = %v", err)
	}
	if gotUser != "user-1" || !reflect.DeepEqual(gotSessionIDs, []string{"session-1"}) || !gotEvent {
		t.Fatalf("walk scope/event = (%q, %#v, %t)", gotUser, gotSessionIDs, gotEvent)
	}
}

func TestWalkSessionSummaryFeatureEventsForUserPassesOwnerAndSelectedSessions(t *testing.T) {
	var gotUser string
	var gotSessionIDs []string
	gotEvent := false
	repository := &HookEventRepository{walkSummaryFeatures: func(_ context.Context, userID string, sessionIDs []string, yield func(HookEvent) error) error {
		gotUser = userID
		gotSessionIDs = append([]string(nil), sessionIDs...)
		return yield(HookEvent{UserID: userID, SessionID: sessionIDs[0], HookEventName: "PreToolUse"})
	}}
	err := repository.WalkSessionSummaryFeatureEventsForUser(context.Background(), "user-1", []string{" session-1 "}, func(event HookEvent) error {
		gotEvent = event.UserID == "user-1" && event.SessionID == "session-1" && event.HookEventName == "PreToolUse"
		return nil
	})
	if err != nil {
		t.Fatalf("WalkSessionSummaryFeatureEventsForUser() error = %v", err)
	}
	if gotUser != "user-1" || !reflect.DeepEqual(gotSessionIDs, []string{"session-1"}) || !gotEvent {
		t.Fatalf("feature walk scope/event = (%q, %#v, %t)", gotUser, gotSessionIDs, gotEvent)
	}
}

func TestListSessionEventsForUserMapsReadFailure(t *testing.T) {
	repository := &HookEventRepository{
		findForUser: func(context.Context, string, string) ([]HookEvent, error) {
			return nil, errors.New("mongo unavailable")
		},
	}

	_, err := repository.ListSessionEventsForUser(context.Background(), "user-1", "session-1")
	var repositoryErr *RepositoryError
	if !errors.As(err, &repositoryErr) || repositoryErr.Operation != "find_session_events" {
		t.Fatalf("error = %v, want find_session_events RepositoryError", err)
	}
}

func TestListSessionEventsForUserRejectsMissingScope(t *testing.T) {
	repository := &HookEventRepository{findForUser: func(context.Context, string, string) ([]HookEvent, error) {
		return nil, nil
	}}
	for _, test := range []struct {
		name    string
		userID  string
		session string
	}{
		{name: "user", session: "session-1"},
		{name: "session", userID: "user-1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := repository.ListSessionEventsForUser(context.Background(), test.userID, test.session); err == nil {
				t.Fatal("expected missing scope error")
			}
		})
	}
}
