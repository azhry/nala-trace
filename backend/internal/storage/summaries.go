package storage

import (
	"time"

	"github.com/azhry/nala-trace/backend/internal/trace"
	"go.mongodb.org/mongo-driver/bson"
)

const mcpToolNamePattern = `^mcp__(?:codex_apps__(?!(?:node_repl)_)[^_\s]+_.+|(?!(?:codex_apps|node_repl)__).+__.+)$`
const codexAppsToolPrefix = "mcp__codex_apps__"

type SessionSummary struct {
	SessionID            string           `bson:"session_id" json:"session_id"`
	Title                string           `bson:"title" json:"title"`
	UserID               string           `bson:"user_id" json:"user_id"`
	FirstEventAt         time.Time        `bson:"first_event_at" json:"first_event_at"`
	LastEventAt          time.Time        `bson:"last_event_at" json:"last_event_at"`
	EventCount           int64            `bson:"event_count" json:"event_count"`
	ToolCallCount        int64            `bson:"tool_call_count" json:"tool_call_count"`
	MCPCallCount         int64            `bson:"mcp_call_count" json:"mcp_call_count"`
	MCPServers           []string         `bson:"mcp_servers" json:"mcp_servers"`
	SkillInvocationCount int64            `bson:"skill_invocation_count" json:"skill_invocation_count"`
	FileOperationCount   int64            `bson:"file_operation_count" json:"file_operation_count"`
	FileReadCount        int64            `bson:"file_read_count" json:"file_read_count"`
	TokenUsage           trace.TokenUsage `bson:"token_usage" json:"token_usage"`
}

func sessionSummaryPipeline() []bson.D {
	return sessionSummaryPipelineForUser("", 0)
}

func sessionSummaryPipelineForUser(userID string, limit int) []bson.D {
	return sessionSummaryPipelineForUserSessions(userID, nil, limit)
}

func sessionSummaryPipelineForUserSessions(userID string, sessionIDs []string, limit int) []bson.D {
	return sessionSummaryPipelineForPayloadRoots(userID, sessionIDs, limit, summaryPayloadRootPaths())
}

func sessionSummaryPipelineForUserSessionsFast(userID string, sessionIDs []string, limit int) []bson.D {
	return sessionSummaryPipelineForPayloadRootsFast(userID, sessionIDs, limit, []string{"$payload"})
}

func sessionSummaryPipelineForPayloadRoots(userID string, sessionIDs []string, limit int, payloadRoots []string) []bson.D {
	return sessionSummaryPipelineForPayloadRootsWithMode(userID, sessionIDs, limit, payloadRoots, false, true)
}

func sessionSummaryPipelineForPayloadRootsFast(userID string, sessionIDs []string, limit int, payloadRoots []string) []bson.D {
	return sessionSummaryPipelineForPayloadRootsWithMode(userID, sessionIDs, limit, payloadRoots, true, true)
}

func sessionSummaryPipelineForUserSessionsFastBase(userID string, sessionIDs []string, limit int) []bson.D {
	return sessionSummaryPipelineForPayloadRootsWithMode(userID, sessionIDs, limit, []string{"$payload"}, true, false)
}

func sessionSummaryPipelineForPayloadRootsWithMode(userID string, sessionIDs []string, limit int, payloadRoots []string, fast, includeFeatures bool) []bson.D {
	toolEvent := preToolUseExpression()
	if fast {
		toolEvent = fieldEqualsExpression("$hook_event_name", "PreToolUse")
	}
	toolEventField := fieldIsTrueExpression("$_summary_tool_event")
	var skillEvent, fileEvent, mcpEvent any = false, false, false
	var fileReadEvent, mcpServer any = false, nil
	if includeFeatures {
		skillEvent = conditionalExpression(toolEventField, skillSignalExpressionForPayloadRoots(payloadRoots), false)
		fileEvent = conditionalExpression(toolEventField, fileSignalExpressionForPayloadRoots(payloadRoots), false)
		mcpEvent = conditionalExpression(toolEventField, mcpSignalExpressionForPayloadRoots(payloadRoots), false)
		fileReadEvent = conditionalExpression(fieldIsTrueExpression("$_summary_file_event"), fileReadSignalExpressionForPayloadRoots(payloadRoots), false)
		mcpServer = conditionalExpression(fieldIsTrueExpression("$_summary_mcp_event"), mcpServerExpressionForPayloadRoots(payloadRoots), nil)
	}
	tokenUsageSignal := tokenUsageSignalExpressionForPayloadRoots(payloadRoots)
	if fast {
		tokenUsageSignal = conditionalExpression(fastTokenUsageCandidateExpression(payloadRoots), tokenUsageSignal, false)
	}
	tokenUsage := sessionTokenUsageExpressionsForPayloadRoots(payloadRoots)
	cumulativeUsage := cumulativeTokenUsageExpressionForPayloadRoots(payloadRoots)
	explicitTitle := firstNonEmptyString(bson.A{
		stringFieldCandidate("$payload.title"),
		stringFieldCandidate("$payload.session_title"),
		stringFieldCandidate("$payload.thread_title"),
	})
	promptTitle := firstNonEmptyString(bson.A{stringFieldCandidate("$payload.prompt")})
	pipeline := make([]bson.D, 0, 9)
	match := make(bson.D, 0, 2)
	if userID != "" {
		match = append(match, bson.E{Key: "user_id", Value: userID})
	}
	if len(sessionIDs) > 0 {
		selectedIDs := make(bson.A, len(sessionIDs))
		for index, sessionID := range sessionIDs {
			selectedIDs[index] = sessionID
		}
		match = append(match, bson.E{Key: "session_id", Value: bson.D{{Key: "$in", Value: selectedIDs}}})
	}
	if len(match) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: match}})
	}
	pipeline = append(pipeline, []bson.D{
		// Keep each session's title candidates chronological while matching the
		// owner/session/time compound index used by the bounded list query.
		{{Key: "$sort", Value: bson.D{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}}},
		{{Key: "$addFields", Value: bson.D{
			{Key: "_summary_tool_event", Value: toolEvent},
			{Key: "_summary_explicit_title", Value: explicitTitle},
			{Key: "_summary_explicit_title_rank", Value: nonEmptyStringRankExpression(explicitTitle)},
			{Key: "_summary_prompt_title", Value: promptTitle},
			{Key: "_summary_prompt_title_rank", Value: nonEmptyStringRankExpression(promptTitle)},
			{Key: "_summary_has_token_usage", Value: tokenUsageSignal},
			{Key: "_summary_token_cumulative_present", Value: cumulativeUsage.present},
		}}},
		{{Key: "$addFields", Value: bson.D{
			{Key: "_summary_token_input_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", tokenUsage.inputTokens)},
			{Key: "_summary_token_cached_input_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", tokenUsage.cachedInputTokens)},
			{Key: "_summary_token_output_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", tokenUsage.outputTokens)},
			{Key: "_summary_token_reasoning_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", tokenUsage.reasoningTokens)},
			{Key: "_summary_token_total_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", tokenUsage.totalTokens)},
			{Key: "_summary_token_cumulative_input_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", cumulativeUsage.inputTokens)},
			{Key: "_summary_token_cumulative_cached_input_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", cumulativeUsage.cachedInputTokens)},
			{Key: "_summary_token_cumulative_output_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", cumulativeUsage.outputTokens)},
			{Key: "_summary_token_cumulative_reasoning_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", cumulativeUsage.reasoningTokens)},
			{Key: "_summary_token_cumulative_total_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", cumulativeUsage.totalTokens)},
			{Key: "_summary_skill_event", Value: skillEvent},
			{Key: "_summary_file_event", Value: fileEvent},
			{Key: "_summary_mcp_event", Value: mcpEvent},
		}}},
		{{Key: "$addFields", Value: bson.D{
			{Key: "_summary_file_read_event", Value: fileReadEvent},
			{Key: "_summary_mcp_server", Value: mcpServer},
		}}},
		{{Key: "$group", Value: bson.D{
			{Key: "_id", Value: "$session_id"},
			{Key: "user_id", Value: bson.D{{Key: "$first", Value: "$user_id"}}},
			{Key: "explicit_title", Value: bson.D{{Key: "$top", Value: bson.D{
				{Key: "sortBy", Value: bson.D{{Key: "_summary_explicit_title_rank", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}},
				{Key: "output", Value: nullableNonEmptyStringExpression("$_summary_explicit_title")},
			}}}},
			{Key: "prompt_title", Value: bson.D{{Key: "$top", Value: bson.D{
				{Key: "sortBy", Value: bson.D{{Key: "_summary_prompt_title_rank", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}},
				{Key: "output", Value: nullableNonEmptyStringExpression("$_summary_prompt_title")},
			}}}},
			{Key: "first_event_at", Value: bson.D{{Key: "$min", Value: "$received_at"}}},
			{Key: "last_event_at", Value: bson.D{{Key: "$max", Value: "$received_at"}}},
			{Key: "event_count", Value: bson.D{{Key: "$sum", Value: 1}}},
			{Key: "tool_call_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{"$_summary_tool_event", 1, 0}}}}}},
			{Key: "mcp_call_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{"$_summary_mcp_event", 1, 0}}}}}},
			{Key: "mcp_servers", Value: bson.D{{Key: "$addToSet", Value: "$_summary_mcp_server"}}},
			{Key: "skill_invocation_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{"$_summary_skill_event", 1, 0}}}}}},
			{Key: "file_operation_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{"$_summary_file_event", 1, 0}}}}}},
			{Key: "file_read_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{"$_summary_file_read_event", 1, 0}}}}}},
			{Key: "token_input_tokens", Value: bson.D{{Key: "$sum", Value: "$_summary_token_input_tokens"}}},
			{Key: "token_cached_input_tokens", Value: bson.D{{Key: "$sum", Value: "$_summary_token_cached_input_tokens"}}},
			{Key: "token_output_tokens", Value: bson.D{{Key: "$sum", Value: "$_summary_token_output_tokens"}}},
			{Key: "token_reasoning_tokens", Value: bson.D{{Key: "$sum", Value: "$_summary_token_reasoning_tokens"}}},
			{Key: "token_total_tokens", Value: bson.D{{Key: "$sum", Value: "$_summary_token_total_tokens"}}},
			{Key: "token_cumulative_present", Value: bson.D{{Key: "$max", Value: "$_summary_token_cumulative_present"}}},
			{Key: "token_cumulative_input_tokens", Value: bson.D{{Key: "$max", Value: "$_summary_token_cumulative_input_tokens"}}},
			{Key: "token_cumulative_cached_input_tokens", Value: bson.D{{Key: "$max", Value: "$_summary_token_cumulative_cached_input_tokens"}}},
			{Key: "token_cumulative_output_tokens", Value: bson.D{{Key: "$max", Value: "$_summary_token_cumulative_output_tokens"}}},
			{Key: "token_cumulative_reasoning_tokens", Value: bson.D{{Key: "$max", Value: "$_summary_token_cumulative_reasoning_tokens"}}},
			{Key: "token_cumulative_total_tokens", Value: bson.D{{Key: "$max", Value: "$_summary_token_cumulative_total_tokens"}}},
		}}},
		{{Key: "$project", Value: bson.D{
			{Key: "_id", Value: 0},
			{Key: "session_id", Value: "$_id"},
			{Key: "title", Value: sessionTitleExpressionFromFields("$explicit_title", "$prompt_title", "$_id")},
			{Key: "user_id", Value: 1},
			{Key: "first_event_at", Value: 1},
			{Key: "last_event_at", Value: 1},
			{Key: "event_count", Value: 1},
			{Key: "tool_call_count", Value: 1},
			{Key: "mcp_call_count", Value: 1},
			{Key: "mcp_servers", Value: bson.D{{Key: "$filter", Value: bson.D{
				{Key: "input", Value: "$mcp_servers"},
				{Key: "as", Value: "server"},
				{Key: "cond", Value: bson.D{{Key: "$ne", Value: bson.A{"$$server", nil}}}},
			}}}},
			{Key: "skill_invocation_count", Value: 1},
			{Key: "file_operation_count", Value: 1},
			{Key: "file_read_count", Value: 1},
			{Key: "token_usage", Value: bson.D{
				{Key: "input_tokens", Value: preferredTokenUsageExpression("$token_cumulative_input_tokens", "$token_input_tokens")},
				{Key: "cached_input_tokens", Value: preferredTokenUsageExpression("$token_cumulative_cached_input_tokens", "$token_cached_input_tokens")},
				{Key: "output_tokens", Value: preferredTokenUsageExpression("$token_cumulative_output_tokens", "$token_output_tokens")},
				{Key: "reasoning_tokens", Value: preferredTokenUsageExpression("$token_cumulative_reasoning_tokens", "$token_reasoning_tokens")},
				{Key: "total_tokens", Value: preferredTokenUsageExpression("$token_cumulative_total_tokens", "$token_total_tokens")},
			}},
		}}},
		{{Key: "$sort", Value: bson.D{{Key: "last_event_at", Value: -1}, {Key: "session_id", Value: 1}}}},
	}...)
	if limit > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$limit", Value: limit}})
	}
	return pipeline
}

func fastTokenUsageCandidateExpression(payloadRoots []string) bson.D {
	usageContainers := make([]bson.D, 0, 5)
	for _, path := range payloadFieldPathsForRoots("usage", payloadRoots) {
		usageContainers = append(usageContainers, fieldHasTypeExpression(path, "object"))
	}
	for _, container := range []string{"response.usage", "tool_response.usage", "output.usage", "result.usage"} {
		for _, path := range payloadFieldPathsForRoots(container, payloadRoots) {
			usageContainers = append(usageContainers, fieldHasTypeExpression(path, "object"))
		}
	}
	return orExpression(
		bson.D{{Key: "$in", Value: bson.A{"$hook_event_name", bson.A{"Stop", "SubagentStop"}}}},
		orExpression(usageContainers...),
	)
}

func sessionSummaryBasePipelineForUserSessions(userID string, sessionIDs []string, limit int) []bson.D {
	match := make(bson.D, 0, 2)
	if userID != "" {
		match = append(match, bson.E{Key: "user_id", Value: userID})
	}
	if len(sessionIDs) > 0 {
		selectedIDs := make(bson.A, len(sessionIDs))
		for index, sessionID := range sessionIDs {
			selectedIDs[index] = sessionID
		}
		match = append(match, bson.E{Key: "session_id", Value: bson.D{{Key: "$in", Value: selectedIDs}}})
	}

	pipeline := make([]bson.D, 0, 5)
	if len(match) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: match}})
	}
	pipeline = append(pipeline,
		bson.D{{Key: "$sort", Value: bson.D{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}}},
		bson.D{{Key: "$group", Value: bson.D{
			{Key: "_id", Value: "$session_id"},
			{Key: "user_id", Value: bson.D{{Key: "$first", Value: "$user_id"}}},
			{Key: "first_event_at", Value: bson.D{{Key: "$min", Value: "$received_at"}}},
			{Key: "last_event_at", Value: bson.D{{Key: "$max", Value: "$received_at"}}},
			{Key: "event_count", Value: bson.D{{Key: "$sum", Value: 1}}},
			{Key: "tool_call_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{
				bson.D{{Key: "$eq", Value: bson.A{"$hook_event_name", "PreToolUse"}}}, 1, 0,
			}}}}}},
		}}},
		bson.D{{Key: "$project", Value: bson.D{
			{Key: "_id", Value: 0},
			{Key: "session_id", Value: "$_id"},
			{Key: "title", Value: "$_id"},
			{Key: "user_id", Value: 1},
			{Key: "first_event_at", Value: 1},
			{Key: "last_event_at", Value: 1},
			{Key: "event_count", Value: 1},
			{Key: "tool_call_count", Value: 1},
		}}},
		bson.D{{Key: "$sort", Value: bson.D{{Key: "last_event_at", Value: -1}, {Key: "session_id", Value: 1}}}},
	)
	if limit > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$limit", Value: limit}})
	}
	return pipeline
}

func sessionSummaryMetadataPipelineForUserSessionsFast(userID string, sessionIDs []string) []bson.D {
	match := bson.D{{Key: "user_id", Value: userID}}
	if len(sessionIDs) > 0 {
		selectedIDs := make(bson.A, len(sessionIDs))
		for index, sessionID := range sessionIDs {
			selectedIDs[index] = sessionID
		}
		match = append(match, bson.E{Key: "session_id", Value: bson.D{{Key: "$in", Value: selectedIDs}}})
	}
	match = append(match, bson.E{Key: "hook_event_name", Value: bson.D{{Key: "$in", Value: bson.A{"SessionStart", "UserPromptSubmit", "Stop", "SubagentStop"}}}})
	payloadRoots := []string{"$payload"}
	tokenUsage := sessionTokenUsageExpressionsForPayloadRoots(payloadRoots)
	cumulativeUsage := cumulativeTokenUsageExpressionForPayloadRoots(payloadRoots)
	explicitTitle := firstNonEmptyString(bson.A{
		stringFieldCandidate("$payload.title"),
		stringFieldCandidate("$payload.session_title"),
		stringFieldCandidate("$payload.thread_title"),
	})
	promptTitle := firstNonEmptyString(bson.A{stringFieldCandidate("$payload.prompt")})
	tokenUsageSignal := tokenUsageSignalExpressionForPayloadRoots(payloadRoots)
	return []bson.D{
		{{Key: "$match", Value: match}},
		{{Key: "$sort", Value: bson.D{{Key: "session_id", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}}},
		{{Key: "$addFields", Value: bson.D{
			{Key: "_summary_explicit_title", Value: explicitTitle},
			{Key: "_summary_explicit_title_rank", Value: nonEmptyStringRankExpression(explicitTitle)},
			{Key: "_summary_prompt_title", Value: promptTitle},
			{Key: "_summary_prompt_title_rank", Value: nonEmptyStringRankExpression(promptTitle)},
			{Key: "_summary_has_token_usage", Value: conditionalExpression(
				bson.D{{Key: "$in", Value: bson.A{"$hook_event_name", bson.A{"Stop", "SubagentStop"}}}},
				tokenUsageSignal,
				false,
			)},
			{Key: "_summary_token_cumulative_present", Value: cumulativeUsage.present},
		}}},
		{{Key: "$addFields", Value: bson.D{
			{Key: "_summary_token_input_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", tokenUsage.inputTokens)},
			{Key: "_summary_token_cached_input_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", tokenUsage.cachedInputTokens)},
			{Key: "_summary_token_output_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", tokenUsage.outputTokens)},
			{Key: "_summary_token_reasoning_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", tokenUsage.reasoningTokens)},
			{Key: "_summary_token_total_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", tokenUsage.totalTokens)},
			{Key: "_summary_token_cumulative_input_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", cumulativeUsage.inputTokens)},
			{Key: "_summary_token_cumulative_cached_input_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", cumulativeUsage.cachedInputTokens)},
			{Key: "_summary_token_cumulative_output_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", cumulativeUsage.outputTokens)},
			{Key: "_summary_token_cumulative_reasoning_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", cumulativeUsage.reasoningTokens)},
			{Key: "_summary_token_cumulative_total_tokens", Value: guardedTokenUsageExpression("$_summary_has_token_usage", cumulativeUsage.totalTokens)},
		}}},
		{{Key: "$group", Value: bson.D{
			{Key: "_id", Value: "$session_id"},
			{Key: "explicit_title", Value: bson.D{{Key: "$top", Value: bson.D{
				{Key: "sortBy", Value: bson.D{{Key: "_summary_explicit_title_rank", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}},
				{Key: "output", Value: nullableNonEmptyStringExpression("$_summary_explicit_title")},
			}}}},
			{Key: "prompt_title", Value: bson.D{{Key: "$top", Value: bson.D{
				{Key: "sortBy", Value: bson.D{{Key: "_summary_prompt_title_rank", Value: 1}, {Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}},
				{Key: "output", Value: nullableNonEmptyStringExpression("$_summary_prompt_title")},
			}}}},
			{Key: "token_input_tokens", Value: bson.D{{Key: "$sum", Value: "$_summary_token_input_tokens"}}},
			{Key: "token_cached_input_tokens", Value: bson.D{{Key: "$sum", Value: "$_summary_token_cached_input_tokens"}}},
			{Key: "token_output_tokens", Value: bson.D{{Key: "$sum", Value: "$_summary_token_output_tokens"}}},
			{Key: "token_reasoning_tokens", Value: bson.D{{Key: "$sum", Value: "$_summary_token_reasoning_tokens"}}},
			{Key: "token_total_tokens", Value: bson.D{{Key: "$sum", Value: "$_summary_token_total_tokens"}}},
			{Key: "token_cumulative_present", Value: bson.D{{Key: "$max", Value: "$_summary_token_cumulative_present"}}},
			{Key: "token_cumulative_input_tokens", Value: bson.D{{Key: "$max", Value: "$_summary_token_cumulative_input_tokens"}}},
			{Key: "token_cumulative_cached_input_tokens", Value: bson.D{{Key: "$max", Value: "$_summary_token_cumulative_cached_input_tokens"}}},
			{Key: "token_cumulative_output_tokens", Value: bson.D{{Key: "$max", Value: "$_summary_token_cumulative_output_tokens"}}},
			{Key: "token_cumulative_reasoning_tokens", Value: bson.D{{Key: "$max", Value: "$_summary_token_cumulative_reasoning_tokens"}}},
			{Key: "token_cumulative_total_tokens", Value: bson.D{{Key: "$max", Value: "$_summary_token_cumulative_total_tokens"}}},
		}}},
		{{Key: "$project", Value: bson.D{
			{Key: "_id", Value: 0},
			{Key: "session_id", Value: "$_id"},
			{Key: "title", Value: sessionTitleExpressionFromFields("$explicit_title", "$prompt_title", "$_id")},
			{Key: "token_usage", Value: bson.D{
				{Key: "input_tokens", Value: preferredTokenUsageExpression("$token_cumulative_input_tokens", "$token_input_tokens")},
				{Key: "cached_input_tokens", Value: preferredTokenUsageExpression("$token_cumulative_cached_input_tokens", "$token_cached_input_tokens")},
				{Key: "output_tokens", Value: preferredTokenUsageExpression("$token_cumulative_output_tokens", "$token_output_tokens")},
				{Key: "reasoning_tokens", Value: preferredTokenUsageExpression("$token_cumulative_reasoning_tokens", "$token_reasoning_tokens")},
				{Key: "total_tokens", Value: preferredTokenUsageExpression("$token_cumulative_total_tokens", "$token_total_tokens")},
			}},
		}}},
	}
}

func preToolUseExpression() bson.D {
	return conditionalExpression(
		fieldHasTypeExpression("$hook_event_name", "string"),
		fieldEqualsExpression("$hook_event_name", "PreToolUse"),
		anyFieldEqualsExpression(payloadFieldPaths("hook_event_name"), "PreToolUse"),
	)
}

func andExpression(expressions ...bson.D) bson.D {
	values := make(bson.A, 0, len(expressions))
	for _, expression := range expressions {
		values = append(values, expression)
	}
	return bson.D{{Key: "$and", Value: values}}
}

func fieldIsTrueExpression(path string) bson.D {
	return bson.D{{Key: "$eq", Value: bson.A{path, true}}}
}

func fieldHasTypeExpression(path, want string) bson.D {
	return bson.D{{Key: "$eq", Value: bson.A{bson.D{{Key: "$type", Value: path}}, want}}}
}

func conditionalExpression(condition, whenTrue, whenFalse any) bson.D {
	return bson.D{{Key: "$cond", Value: bson.A{condition, whenTrue, whenFalse}}}
}

func orExpression(expressions ...bson.D) bson.D {
	result := bson.D{{Key: "$literal", Value: false}}
	for index := len(expressions) - 1; index >= 0; index-- {
		result = conditionalExpression(expressions[index], true, result)
	}
	return result
}

func guardedTokenUsageExpression(signal string, expression bson.D) bson.D {
	return conditionalExpression(fieldIsTrueExpression(signal), expression, int64(0))
}

func skillSignalExpression() bson.D {
	return skillSignalExpressionForPayloadRoots(summaryPayloadRootPaths())
}

func skillSignalExpressionForPayloadRoots(payloadRoots []string) bson.D {
	toolNameSkill := conditionalExpression(
		fieldHasTypeExpression("$tool_name", "string"),
		regexFieldExpression("$tool_name", "skill"),
		anyRegexFieldExpression(payloadFieldPathsForRoots("tool_name", payloadRoots), "skill"),
	)
	return orExpression(
		toolNameSkill,
		anyNonEmptyStringExpression(payloadFieldPathsForRoots("skill", payloadRoots)...),
		anyNonEmptyStringExpression(payloadFieldPathsForRoots("skill_name", payloadRoots)...),
		anyNonEmptyStringExpression(payloadFieldPathsForRoots("tool_input.skill", payloadRoots)...),
		anyNonEmptyStringExpression(payloadFieldPathsForRoots("tool_input.skill_name", payloadRoots)...),
		anyArrayNonEmptyExpression(payloadFieldPathsForRoots("skills", payloadRoots)...),
		anyArrayNonEmptyExpression(payloadFieldPathsForRoots("tool_input.skills", payloadRoots)...),
		skillDocumentSignalExpressionForPayloadRoots(payloadRoots),
	)
}

func skillDocumentSignalExpression() bson.D {
	return skillDocumentSignalExpressionForPayloadRoots(summaryPayloadRootPaths())
}

func skillDocumentSignalExpressionForPayloadRoots(payloadRoots []string) bson.D {
	paths := append([]string{}, payloadFieldPathsForRoots("tool_input.command", payloadRoots)...)
	paths = append(paths, payloadFieldPathsForRoots("tool_input.file_path", payloadRoots)...)
	paths = append(paths, payloadFieldPathsForRoots("tool_input.path", payloadRoots)...)
	paths = append(paths, payloadFieldPathsForRoots("tool_input.target_file", payloadRoots)...)
	paths = append(paths, payloadFieldPathsForRoots("tool_input.filename", payloadRoots)...)
	paths = append(paths, payloadFieldPathsForRoots("tool_input.file", payloadRoots)...)
	return anyRegexFieldExpression(paths, `(?:^|[\\/])skills[\\/]+(?:\.system[\\/]+)?[^\\/\s]+[\\/]+SKILL\.md`)
}

func fileSignalExpression() bson.D {
	return fileSignalExpressionForPayloadRoots(summaryPayloadRootPaths())
}

func fileSignalExpressionForPayloadRoots(payloadRoots []string) bson.D {
	patchTextPaths := make([]string, 0, len(payloadRoots)*4)
	for _, field := range []string{"tool_input.patch", "tool_input.patch_text", "tool_input.diff", "tool_input.content"} {
		patchTextPaths = append(patchTextPaths, payloadFieldPathsForRoots(field, payloadRoots)...)
	}
	commandPaths := payloadFieldPathsForRoots("tool_input.command", payloadRoots)
	return orExpression(
		anyNonEmptyStringExpression(payloadFieldPathsForRoots("tool_input.file_path", payloadRoots)...),
		anyNonEmptyStringExpression(payloadFieldPathsForRoots("tool_input.path", payloadRoots)...),
		anyNonEmptyStringExpression(payloadFieldPathsForRoots("tool_input.target_file", payloadRoots)...),
		anyNonEmptyStringExpression(payloadFieldPathsForRoots("tool_input.filename", payloadRoots)...),
		anyNonEmptyStringExpression(payloadFieldPathsForRoots("tool_input.file", payloadRoots)...),
		anyNonEmptyStringExpression(payloadFieldPathsForRoots("tool_input.old_path", payloadRoots)...),
		anyNonEmptyStringExpression(payloadFieldPathsForRoots("tool_input.new_path", payloadRoots)...),
		anyRegexFieldExpression(patchTextPaths, `\*\*\* (Add|Update|Delete|Move to) File:`),
		anyRegexFieldExpression(commandPaths, `(^|\s)(cat|head|tail|type|get-content|read|set-content|out-file|tee|remove-item|rm|del|delete)(\s|$)`),
		anyRegexFieldExpression(commandPaths, `(-literalpath|-filepath|-path|>|cat|head|tail|type|get-content|read)\s*`),
	)
}

func fileReadSignalExpression() bson.D {
	return fileReadSignalExpressionForPayloadRoots(summaryPayloadRootPaths())
}

func fileReadSignalExpressionForPayloadRoots(payloadRoots []string) bson.D {
	return orExpression(
		anyFieldEqualsExpression(payloadFieldPathsForRoots("tool_input.operation", payloadRoots), "read"),
		anyFieldEqualsExpression(payloadFieldPathsForRoots("tool_input.action", payloadRoots), "read"),
		anyRegexFieldExpression(append([]string{"$tool_name"}, payloadFieldPathsForRoots("tool_name", payloadRoots)...), `(read|cat|get-content|open)`),
		anyRegexFieldExpression(payloadFieldPathsForRoots("tool_input.command", payloadRoots), `(^|\s)(cat|head|tail|type|get-content|read)(\s|$)`),
	)
}

func mcpSignalExpression() bson.D {
	return mcpSignalExpressionForPayloadRoots(summaryPayloadRootPaths())
}

func mcpSignalExpressionForPayloadRoots(payloadRoots []string) bson.D {
	return conditionalExpression(
		fieldHasTypeExpression("$tool_name", "string"),
		regexFieldExpression("$tool_name", mcpToolNamePattern),
		anyRegexFieldExpression(payloadFieldPathsForRoots("tool_name", payloadRoots), mcpToolNamePattern),
	)
}

func mcpToolNameExpression() bson.D {
	return mcpToolNameExpressionForPayloadRoots(summaryPayloadRootPaths())
}

func mcpToolNameExpressionForPayloadRoots(payloadRoots []string) bson.D {
	candidates := make(bson.A, 0, len(payloadRoots))
	for _, root := range payloadRoots {
		candidates = append(candidates, stringFieldCandidate(root+".tool_name"))
	}
	nestedToolName := firstMatchingString(candidates, mcpToolNamePattern)
	return conditionalExpression(fieldHasTypeExpression("$tool_name", "string"), "$tool_name", nestedToolName)
}

func mcpServerExpression() bson.D {
	return mcpServerExpressionForPayloadRoots(summaryPayloadRootPaths())
}

func mcpServerExpressionForPayloadRoots(payloadRoots []string) bson.D {
	return mcpServerExpressionForName(mcpToolNameExpressionForPayloadRoots(payloadRoots))
}

func mcpServerExpressionForName(name bson.D) bson.D {
	return bson.D{{Key: "$let", Value: bson.D{
		{Key: "vars", Value: bson.D{{Key: "name", Value: name}}},
		{Key: "in", Value: bson.D{{Key: "$cond", Value: bson.A{
			bson.D{{Key: "$regexMatch", Value: bson.D{
				{Key: "input", Value: "$$name"},
				{Key: "regex", Value: "^mcp__codex_apps__"},
				{Key: "options", Value: "i"},
			}}},
			mcpCodexAppsServerExpression(),
			mcpDirectServerExpression(),
		}}}},
	}}}
}

func mcpDirectServerExpression() bson.D {
	separator := bson.D{{Key: "$indexOfCP", Value: bson.A{"$$name", "__", 5}}}
	return bson.D{{Key: "$toLower", Value: bson.D{{Key: "$substrCP", Value: bson.A{
		"$$name",
		5,
		bson.D{{Key: "$subtract", Value: bson.A{separator, 5}}},
	}}}}}
}

func mcpCodexAppsServerExpression() bson.D {
	connectorName := bson.D{{Key: "$substrCP", Value: bson.A{
		"$$name",
		len(codexAppsToolPrefix),
		bson.D{{Key: "$subtract", Value: bson.A{
			bson.D{{Key: "$strLenCP", Value: "$$name"}},
			len(codexAppsToolPrefix),
		}}},
	}}}
	separator := bson.D{{Key: "$indexOfCP", Value: bson.A{connectorName, "_"}}}
	return bson.D{{Key: "$toLower", Value: bson.D{{Key: "$substrCP", Value: bson.A{
		connectorName,
		0,
		separator,
	}}}}}
}

func payloadFieldPaths(field string) []string {
	return payloadFieldPathsForRoots(field, summaryPayloadRootPaths())
}

func summaryPayloadRootPaths() []string {
	return []string{"$payload", "$payload.payload", "$payload.raw", "$payload.data", "$payload.event"}
}

func payloadFieldPathsForRoots(field string, roots []string) []string {
	paths := make([]string, 0, len(roots))
	for _, root := range roots {
		paths = append(paths, root+"."+field)
	}
	return paths
}

type tokenUsageExpressions struct {
	inputTokens       bson.D
	cachedInputTokens bson.D
	outputTokens      bson.D
	reasoningTokens   bson.D
	totalTokens       bson.D
}

type cumulativeTokenUsageExpressions struct {
	present           bson.D
	inputTokens       bson.D
	cachedInputTokens bson.D
	outputTokens      bson.D
	reasoningTokens   bson.D
	totalTokens       bson.D
}

func sessionTokenUsageExpressions() tokenUsageExpressions {
	return sessionTokenUsageExpressionsForPayloadRoots(summaryPayloadRootPaths())
}

func sessionTokenUsageExpressionsForPayloadRoots(payloadRoots []string) tokenUsageExpressions {
	inputTokens := firstNumericExpression(tokenUsageFieldPathsForPayloadRoots("input_tokens", payloadRoots), "long")
	cachedInputTokens := firstNumericExpression(append(
		tokenUsageFieldPathsForPayloadRoots("cached_input_tokens", payloadRoots),
		tokenUsageFieldPathsForPayloadRoots("cached_tokens", payloadRoots)...,
	), "long")
	if inputDetails := firstNumericExpression(append(
		tokenUsageFieldPathsForPayloadRoots("input_tokens_details.cached_tokens", payloadRoots),
		tokenUsageFieldPathsForPayloadRoots("prompt_tokens_details.cached_tokens", payloadRoots)...,
	), "long"); inputDetails != nil {
		cachedInputTokens = firstNonNullNumericExpression(cachedInputTokens, inputDetails)
	}
	outputTokens := firstNumericExpression(tokenUsageFieldPathsForPayloadRoots("output_tokens", payloadRoots), "long")
	reasoningTokens := firstNumericExpression(append(
		tokenUsageFieldPathsForPayloadRoots("reasoning_tokens", payloadRoots),
		tokenUsageFieldPathsForPayloadRoots("reasoning_output_tokens", payloadRoots)...,
	), "long")
	if outputDetails := firstNumericExpression(append(
		tokenUsageFieldPathsForPayloadRoots("output_tokens_details.reasoning_tokens", payloadRoots),
		tokenUsageFieldPathsForPayloadRoots("completion_tokens_details.reasoning_tokens", payloadRoots)...,
	), "long"); outputDetails != nil {
		reasoningTokens = firstNonNullNumericExpression(reasoningTokens, outputDetails)
	}
	totalTokens := firstNonNullNumericExpression(
		firstNumericExpression(tokenUsageFieldPathsForPayloadRoots("total_tokens", payloadRoots), "long"),
		bson.D{{Key: "$add", Value: bson.A{zeroIfNull(inputTokens), zeroIfNull(outputTokens)}}},
	)
	return tokenUsageExpressions{
		inputTokens:       zeroIfNull(inputTokens),
		cachedInputTokens: zeroIfNull(cachedInputTokens),
		outputTokens:      zeroIfNull(outputTokens),
		reasoningTokens:   zeroIfNull(reasoningTokens),
		totalTokens:       zeroIfNull(totalTokens),
	}
}

func cumulativeTokenUsageExpression() cumulativeTokenUsageExpressions {
	return cumulativeTokenUsageExpressionForPayloadRoots(summaryPayloadRootPaths())
}

func cumulativeTokenUsageExpressionForPayloadRoots(payloadRoots []string) cumulativeTokenUsageExpressions {
	present := anyFieldEqualsExpression(payloadFieldPathsForRoots("usage_source", payloadRoots), "codex_transcript")
	return cumulativeTokenUsageExpressions{
		present:           bson.D{{Key: "$cond", Value: bson.A{present, 1, 0}}},
		inputTokens:       cumulativeValueExpression(present, firstNumericExpression(tokenUsageFieldPathsForPayloadRoots("input_tokens", payloadRoots), "long")),
		cachedInputTokens: cumulativeValueExpression(present, firstNumericExpression(append(tokenUsageFieldPathsForPayloadRoots("cached_input_tokens", payloadRoots), tokenUsageFieldPathsForPayloadRoots("cached_tokens", payloadRoots)...), "long")),
		outputTokens:      cumulativeValueExpression(present, firstNumericExpression(tokenUsageFieldPathsForPayloadRoots("output_tokens", payloadRoots), "long")),
		reasoningTokens:   cumulativeValueExpression(present, firstNumericExpression(append(tokenUsageFieldPathsForPayloadRoots("reasoning_tokens", payloadRoots), tokenUsageFieldPathsForPayloadRoots("reasoning_output_tokens", payloadRoots)...), "long")),
		totalTokens:       cumulativeValueExpression(present, firstNumericExpression(tokenUsageFieldPathsForPayloadRoots("total_tokens", payloadRoots), "long")),
	}
}

func cumulativeValueExpression(present bson.D, value bson.D) bson.D {
	return bson.D{{Key: "$cond", Value: bson.A{present, zeroIfNull(value), 0}}}
}

func preferredTokenUsageExpression(cumulativeField, summedField string) bson.D {
	return bson.D{{Key: "$cond", Value: bson.A{
		bson.D{{Key: "$eq", Value: bson.A{"$token_cumulative_present", 1}}},
		cumulativeField,
		summedField,
	}}}
}

func tokenUsageFieldPaths(field string) []string {
	return tokenUsageFieldPathsForPayloadRoots(field, summaryPayloadRootPaths())
}

func tokenUsageFieldPathsForPayloadRoots(field string, payloadRoots []string) []string {
	containers := []string{
		"usage." + field,
		"response.usage." + field,
		"tool_response.usage." + field,
		"output.usage." + field,
		"result.usage." + field,
		"response." + field,
		"tool_response." + field,
		"output." + field,
		"result." + field,
	}
	paths := make([]string, 0, len(containers)*len(payloadRoots))
	for _, container := range containers {
		paths = append(paths, payloadFieldPathsForRoots(container, payloadRoots)...)
	}
	return paths
}

func tokenUsageSignalExpression() bson.D {
	return tokenUsageSignalExpressionForPayloadRoots(summaryPayloadRootPaths())
}

func tokenUsageSignalExpressionForPayloadRoots(payloadRoots []string) bson.D {
	tokenFields := []string{
		"input_tokens",
		"cached_input_tokens",
		"cached_tokens",
		"input_tokens_details.cached_tokens",
		"prompt_tokens_details.cached_tokens",
		"output_tokens",
		"reasoning_tokens",
		"reasoning_output_tokens",
		"output_tokens_details.reasoning_tokens",
		"completion_tokens_details.reasoning_tokens",
		"total_tokens",
	}
	values := make([]bson.D, 0, 70)
	for _, container := range []string{"usage", "response.usage", "tool_response.usage", "output.usage", "result.usage"} {
		for _, path := range payloadFieldPathsForRoots(container, payloadRoots) {
			values = append(values, fieldHasTypeExpression(path, "object"))
		}
	}
	for _, container := range []string{"response", "tool_response", "output", "result"} {
		for _, parent := range payloadFieldPathsForRoots(container, payloadRoots) {
			paths := make([]string, 0, len(tokenFields))
			for _, field := range tokenFields {
				paths = append(paths, parent+"."+field)
			}
			values = append(values, conditionalExpression(fieldHasTypeExpression(parent, "object"), anyNonNullFieldExpression(paths), false))
		}
	}
	for _, parent := range payloadRoots {
		paths := make([]string, 0, len(tokenFields))
		for _, field := range tokenFields {
			paths = append(paths, parent+"."+field)
		}
		values = append(values, conditionalExpression(fieldHasTypeExpression(parent, "object"), anyNonNullFieldExpression(paths), false))
	}
	return orExpression(values...)
}

func anyNonNullFieldExpression(paths []string) bson.D {
	values := make([]bson.D, 0, len(paths))
	for _, path := range paths {
		fieldType := bson.D{{Key: "$type", Value: path}}
		values = append(values, bson.D{{Key: "$and", Value: bson.A{
			bson.D{{Key: "$ne", Value: bson.A{fieldType, "missing"}}},
			bson.D{{Key: "$ne", Value: bson.A{fieldType, "null"}}},
		}}})
	}
	return orExpression(values...)
}

func firstNumericExpression(paths []string, target string) bson.D {
	candidates := make(bson.A, 0, len(paths))
	for _, path := range paths {
		candidates = append(candidates, path)
	}
	converted := bson.D{{Key: "$map", Value: bson.D{
		{Key: "input", Value: candidates},
		{Key: "as", Value: "candidate"},
		{Key: "in", Value: bson.D{{Key: "$convert", Value: bson.D{
			{Key: "input", Value: "$$candidate"},
			{Key: "to", Value: target},
			{Key: "onError", Value: nil},
			{Key: "onNull", Value: nil},
		}}}},
	}}}
	return bson.D{{Key: "$arrayElemAt", Value: bson.A{
		bson.D{{Key: "$filter", Value: bson.D{
			{Key: "input", Value: converted},
			{Key: "as", Value: "candidate"},
			{Key: "cond", Value: bson.D{{Key: "$ne", Value: bson.A{"$$candidate", nil}}}},
		}}},
		0,
	}}}
}

func firstNonNullNumericExpression(primary, fallback bson.D) bson.D {
	return bson.D{{Key: "$ifNull", Value: bson.A{primary, fallback}}}
}

func zeroIfNull(expression bson.D) bson.D {
	return bson.D{{Key: "$ifNull", Value: bson.A{expression, 0}}}
}

func firstMatchingString(candidates bson.A, regex string) bson.D {
	return bson.D{{Key: "$arrayElemAt", Value: bson.A{
		bson.D{{Key: "$map", Value: bson.D{
			{Key: "input", Value: bson.D{{Key: "$filter", Value: bson.D{
				{Key: "input", Value: candidates},
				{Key: "as", Value: "candidate"},
				{Key: "cond", Value: bson.D{{Key: "$regexMatch", Value: bson.D{
					{Key: "input", Value: "$$candidate"},
					{Key: "regex", Value: regex},
					{Key: "options", Value: "i"},
				}}}},
			}}}},
			{Key: "as", Value: "candidate"},
			{Key: "in", Value: "$$candidate"},
		}}},
		0,
	}}}
}

func anyNonEmptyStringExpression(paths ...string) bson.D {
	values := make([]bson.D, 0, len(paths))
	for _, path := range paths {
		values = append(values, nonEmptyStringExpression(path))
	}
	return orExpression(values...)
}

func anyArrayNonEmptyExpression(paths ...string) bson.D {
	values := make([]bson.D, 0, len(paths))
	for _, path := range paths {
		arrayValue := bson.D{{Key: "$cond", Value: bson.A{
			bson.D{{Key: "$isArray", Value: path}},
			path,
			bson.A{},
		}}}
		values = append(values, bson.D{{Key: "$gt", Value: bson.A{
			bson.D{{Key: "$size", Value: arrayValue}},
			0,
		}}})
	}
	return orExpression(values...)
}

func anyFieldEqualsExpression(paths []string, want string) bson.D {
	values := make([]bson.D, 0, len(paths))
	for _, path := range paths {
		values = append(values, fieldEqualsExpression(path, want))
	}
	return orExpression(values...)
}

func anyRegexFieldExpression(paths []string, regex string) bson.D {
	values := make([]bson.D, 0, len(paths))
	for _, path := range paths {
		values = append(values, regexFieldExpression(path, regex))
	}
	return orExpression(values...)
}

func nonEmptyStringExpression(path string) bson.D {
	converted := convertToStringExpression(path)
	return bson.D{{Key: "$ne", Value: bson.A{bson.D{{Key: "$trim", Value: bson.D{{Key: "input", Value: converted}}}}, ""}}}
}

func fieldEqualsExpression(path, want string) bson.D {
	return bson.D{{Key: "$eq", Value: bson.A{convertToStringExpression(path), want}}}
}

func regexFieldExpression(path, regex string) bson.D {
	return bson.D{{Key: "$regexMatch", Value: bson.D{
		{Key: "input", Value: convertToStringExpression(path)},
		{Key: "regex", Value: regex},
		{Key: "options", Value: "i"},
	}}}
}

func convertToStringExpression(path string) bson.D {
	return bson.D{{Key: "$convert", Value: bson.D{
		{Key: "input", Value: path},
		{Key: "to", Value: "string"},
		{Key: "onError", Value: ""},
		{Key: "onNull", Value: ""},
	}}}
}

func stringFieldCandidate(path string) bson.D {
	return bson.D{{Key: "$cond", Value: bson.A{
		bson.D{{Key: "$eq", Value: bson.A{bson.D{{Key: "$type", Value: path}}, "string"}}},
		bson.D{{Key: "$trim", Value: bson.D{{Key: "input", Value: bson.D{{Key: "$ifNull", Value: bson.A{path, ""}}}}}}},
		"",
	}}}
}

func firstNonEmptyString(candidates bson.A) bson.D {
	return bson.D{{Key: "$arrayElemAt", Value: bson.A{
		bson.D{{Key: "$filter", Value: bson.D{
			{Key: "input", Value: candidates},
			{Key: "as", Value: "candidate"},
			{Key: "cond", Value: bson.D{{Key: "$ne", Value: bson.A{"$$candidate", ""}}}},
		}}},
		0,
	}}}
}

func nonEmptyStringRankExpression(candidate any) bson.D {
	return bson.D{{Key: "$cond", Value: bson.A{
		bson.D{{Key: "$eq", Value: bson.A{candidate, ""}}},
		1,
		0,
	}}}
}

func nullableNonEmptyStringExpression(path string) bson.D {
	return bson.D{{Key: "$cond", Value: bson.A{
		bson.D{{Key: "$eq", Value: bson.A{path, ""}}},
		nil,
		path,
	}}}
}

func firstCandidate(path string) bson.D {
	return bson.D{{Key: "$arrayElemAt", Value: bson.A{
		bson.D{{Key: "$filter", Value: bson.D{
			{Key: "input", Value: path},
			{Key: "as", Value: "candidate"},
			{Key: "cond", Value: bson.D{{Key: "$ne", Value: bson.A{"$$candidate", ""}}}},
		}}},
		0,
	}}}
}

func sessionTitleExpression() bson.D {
	return sessionTitleExpressionFromFields(
		firstCandidate("$explicit_title_candidates"),
		firstCandidate("$prompt_title_candidates"),
		"$_id",
	)
}

func sessionTitleExpressionFromFields(explicitTitle, promptTitle, fallback any) bson.D {
	return bson.D{{Key: "$let", Value: bson.D{
		{Key: "vars", Value: bson.D{
			{Key: "explicit", Value: explicitTitle},
			{Key: "prompt", Value: promptTitle},
		}},
		{Key: "in", Value: bson.D{{Key: "$ifNull", Value: bson.A{
			"$$explicit",
			bson.D{{Key: "$ifNull", Value: bson.A{"$$prompt", fallback}}},
		}}}},
	}}}
}
