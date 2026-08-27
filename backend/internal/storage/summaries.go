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
	toolEvent := preToolUseExpression()
	skillEvent := andExpression(toolEvent, skillSignalExpression())
	fileEvent := andExpression(toolEvent, fileSignalExpression())
	fileReadEvent := andExpression(toolEvent, fileSignalExpression(), fileReadSignalExpression())
	mcpEvent := andExpression(toolEvent, mcpSignalExpression())
	tokenUsage := sessionTokenUsageExpressions()
	cumulativeUsage := cumulativeTokenUsageExpression()
	explicitTitle := firstNonEmptyString(bson.A{
		stringFieldCandidate("$payload.title"),
		stringFieldCandidate("$payload.session_title"),
		stringFieldCandidate("$payload.thread_title"),
	})
	promptTitle := firstNonEmptyString(bson.A{stringFieldCandidate("$payload.prompt")})
	pipeline := make([]bson.D, 0, 8)
	if userID != "" {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: bson.D{{Key: "user_id", Value: userID}}}})
	}
	pipeline = append(pipeline, []bson.D{
		{{Key: "$sort", Value: bson.D{{Key: "received_at", Value: 1}, {Key: "_id", Value: 1}}}},
		{{Key: "$group", Value: bson.D{
			{Key: "_id", Value: "$session_id"},
			{Key: "user_id", Value: bson.D{{Key: "$first", Value: "$user_id"}}},
			{Key: "explicit_title_candidates", Value: bson.D{{Key: "$push", Value: explicitTitle}}},
			{Key: "prompt_title_candidates", Value: bson.D{{Key: "$push", Value: promptTitle}}},
			{Key: "first_event_at", Value: bson.D{{Key: "$min", Value: "$received_at"}}},
			{Key: "last_event_at", Value: bson.D{{Key: "$max", Value: "$received_at"}}},
			{Key: "event_count", Value: bson.D{{Key: "$sum", Value: 1}}},
			{Key: "tool_call_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{toolEvent, 1, 0}}}}}},
			{Key: "mcp_call_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{mcpEvent, 1, 0}}}}}},
			{Key: "mcp_servers", Value: bson.D{{Key: "$addToSet", Value: bson.D{{Key: "$cond", Value: bson.A{mcpEvent, mcpServerExpression(), nil}}}}}},
			{Key: "skill_invocation_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{skillEvent, 1, 0}}}}}},
			{Key: "file_operation_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{fileEvent, 1, 0}}}}}},
			{Key: "file_read_count", Value: bson.D{{Key: "$sum", Value: bson.D{{Key: "$cond", Value: bson.A{fileReadEvent, 1, 0}}}}}},
			{Key: "token_input_tokens", Value: bson.D{{Key: "$sum", Value: tokenUsage.inputTokens}}},
			{Key: "token_cached_input_tokens", Value: bson.D{{Key: "$sum", Value: tokenUsage.cachedInputTokens}}},
			{Key: "token_output_tokens", Value: bson.D{{Key: "$sum", Value: tokenUsage.outputTokens}}},
			{Key: "token_reasoning_tokens", Value: bson.D{{Key: "$sum", Value: tokenUsage.reasoningTokens}}},
			{Key: "token_total_tokens", Value: bson.D{{Key: "$sum", Value: tokenUsage.totalTokens}}},
			{Key: "token_cost_usd", Value: bson.D{{Key: "$sum", Value: tokenUsage.costUSD}}},
			{Key: "token_cumulative_present", Value: bson.D{{Key: "$max", Value: cumulativeUsage.present}}},
			{Key: "token_cumulative_input_tokens", Value: bson.D{{Key: "$max", Value: cumulativeUsage.inputTokens}}},
			{Key: "token_cumulative_cached_input_tokens", Value: bson.D{{Key: "$max", Value: cumulativeUsage.cachedInputTokens}}},
			{Key: "token_cumulative_output_tokens", Value: bson.D{{Key: "$max", Value: cumulativeUsage.outputTokens}}},
			{Key: "token_cumulative_reasoning_tokens", Value: bson.D{{Key: "$max", Value: cumulativeUsage.reasoningTokens}}},
			{Key: "token_cumulative_total_tokens", Value: bson.D{{Key: "$max", Value: cumulativeUsage.totalTokens}}},
			{Key: "token_cumulative_cost_usd", Value: bson.D{{Key: "$max", Value: cumulativeUsage.costUSD}}},
		}}},
		{{Key: "$project", Value: bson.D{
			{Key: "_id", Value: 0},
			{Key: "session_id", Value: "$_id"},
			{Key: "title", Value: sessionTitleExpression()},
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
				{Key: "cost_usd", Value: preferredTokenUsageExpression("$token_cumulative_cost_usd", "$token_cost_usd")},
			}},
		}}},
		{{Key: "$sort", Value: bson.D{{Key: "last_event_at", Value: -1}, {Key: "session_id", Value: 1}}}},
	}...)
	if limit > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$limit", Value: limit}})
	}
	return pipeline
}

func preToolUseExpression() bson.D {
	return anyFieldEqualsExpression(append([]string{"$hook_event_name"}, payloadFieldPaths("hook_event_name")...), "PreToolUse")
}

func andExpression(expressions ...bson.D) bson.D {
	values := make(bson.A, 0, len(expressions))
	for _, expression := range expressions {
		values = append(values, expression)
	}
	return bson.D{{Key: "$and", Value: values}}
}

func skillSignalExpression() bson.D {
	return bson.D{{Key: "$or", Value: bson.A{
		anyRegexFieldExpression(append([]string{"$tool_name"}, payloadFieldPaths("tool_name")...), "skill"),
		anyNonEmptyStringExpression(payloadFieldPaths("skill")...),
		anyNonEmptyStringExpression(payloadFieldPaths("skill_name")...),
		anyNonEmptyStringExpression(payloadFieldPaths("tool_input.skill")...),
		anyNonEmptyStringExpression(payloadFieldPaths("tool_input.skill_name")...),
		anyArrayNonEmptyExpression(payloadFieldPaths("skills")...),
		anyArrayNonEmptyExpression(payloadFieldPaths("tool_input.skills")...),
		skillDocumentSignalExpression(),
	}}}
}

func skillDocumentSignalExpression() bson.D {
	paths := append([]string{}, payloadFieldPaths("tool_input.command")...)
	paths = append(paths, payloadFieldPaths("tool_input.file_path")...)
	paths = append(paths, payloadFieldPaths("tool_input.path")...)
	paths = append(paths, payloadFieldPaths("tool_input.target_file")...)
	paths = append(paths, payloadFieldPaths("tool_input.filename")...)
	paths = append(paths, payloadFieldPaths("tool_input.file")...)
	return anyRegexFieldExpression(paths, `(?:^|[\\/])skills[\\/]+(?:\.system[\\/]+)?[^\\/\s]+[\\/]+SKILL\.md`)
}

func fileSignalExpression() bson.D {
	return bson.D{{Key: "$or", Value: bson.A{
		anyNonEmptyStringExpression(payloadFieldPaths("tool_input.file_path")...),
		anyNonEmptyStringExpression(payloadFieldPaths("tool_input.path")...),
		anyNonEmptyStringExpression(payloadFieldPaths("tool_input.target_file")...),
		anyNonEmptyStringExpression(payloadFieldPaths("tool_input.filename")...),
		anyNonEmptyStringExpression(payloadFieldPaths("tool_input.file")...),
		anyNonEmptyStringExpression(payloadFieldPaths("tool_input.old_path")...),
		anyNonEmptyStringExpression(payloadFieldPaths("tool_input.new_path")...),
		anyRegexFieldExpression(payloadFieldPaths("tool_input"), `\*\*\* (Add|Update|Delete|Move to) File:`),
		anyRegexFieldExpression(payloadFieldPaths("tool_input.command"), `(^|\s)(cat|head|tail|type|get-content|read|set-content|out-file|tee|remove-item|rm|del|delete)(\s|$)`),
	}}}
}

func fileReadSignalExpression() bson.D {
	return bson.D{{Key: "$or", Value: bson.A{
		anyFieldEqualsExpression(payloadFieldPaths("tool_input.operation"), "read"),
		anyFieldEqualsExpression(payloadFieldPaths("tool_input.action"), "read"),
		anyRegexFieldExpression(append([]string{"$tool_name"}, payloadFieldPaths("tool_name")...), `(read|cat|get-content|open)`),
		anyRegexFieldExpression(payloadFieldPaths("tool_input.command"), `(^|\s)(cat|head|tail|type|get-content|read)(\s|$)`),
	}}}
}

func mcpSignalExpression() bson.D {
	return anyRegexFieldExpression(append([]string{"$tool_name"}, payloadFieldPaths("tool_name")...), mcpToolNamePattern)
}

func mcpToolNameExpression() bson.D {
	return firstMatchingString(bson.A{
		stringFieldCandidate("$tool_name"),
		stringFieldCandidate("$payload.tool_name"),
		stringFieldCandidate("$payload.payload.tool_name"),
		stringFieldCandidate("$payload.raw.tool_name"),
		stringFieldCandidate("$payload.data.tool_name"),
		stringFieldCandidate("$payload.event.tool_name"),
	}, mcpToolNamePattern)
}

func mcpServerExpression() bson.D {
	name := mcpToolNameExpression()
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
	return []string{
		"$payload." + field,
		"$payload.payload." + field,
		"$payload.raw." + field,
		"$payload.data." + field,
		"$payload.event." + field,
	}
}

type tokenUsageExpressions struct {
	inputTokens       bson.D
	cachedInputTokens bson.D
	outputTokens      bson.D
	reasoningTokens   bson.D
	totalTokens       bson.D
	costUSD           bson.D
}

type cumulativeTokenUsageExpressions struct {
	present           bson.D
	inputTokens       bson.D
	cachedInputTokens bson.D
	outputTokens      bson.D
	reasoningTokens   bson.D
	totalTokens       bson.D
	costUSD           bson.D
}

func sessionTokenUsageExpressions() tokenUsageExpressions {
	inputTokens := firstNumericExpression(tokenUsageFieldPaths("input_tokens"), "long")
	cachedInputTokens := firstNumericExpression(append(
		tokenUsageFieldPaths("cached_input_tokens"),
		tokenUsageFieldPaths("cached_tokens")...,
	), "long")
	if inputDetails := firstNumericExpression(append(
		tokenUsageFieldPaths("input_tokens_details.cached_tokens"),
		tokenUsageFieldPaths("prompt_tokens_details.cached_tokens")...,
	), "long"); inputDetails != nil {
		cachedInputTokens = firstNonNullNumericExpression(cachedInputTokens, inputDetails)
	}
	outputTokens := firstNumericExpression(tokenUsageFieldPaths("output_tokens"), "long")
	reasoningTokens := firstNumericExpression(append(
		tokenUsageFieldPaths("reasoning_tokens"),
		tokenUsageFieldPaths("reasoning_output_tokens")...,
	), "long")
	if outputDetails := firstNumericExpression(append(
		tokenUsageFieldPaths("output_tokens_details.reasoning_tokens"),
		tokenUsageFieldPaths("completion_tokens_details.reasoning_tokens")...,
	), "long"); outputDetails != nil {
		reasoningTokens = firstNonNullNumericExpression(reasoningTokens, outputDetails)
	}
	totalTokens := firstNonNullNumericExpression(
		firstNumericExpression(tokenUsageFieldPaths("total_tokens"), "long"),
		bson.D{{Key: "$add", Value: bson.A{zeroIfNull(inputTokens), zeroIfNull(outputTokens)}}},
	)
	return tokenUsageExpressions{
		inputTokens:       zeroIfNull(inputTokens),
		cachedInputTokens: zeroIfNull(cachedInputTokens),
		outputTokens:      zeroIfNull(outputTokens),
		reasoningTokens:   zeroIfNull(reasoningTokens),
		totalTokens:       zeroIfNull(totalTokens),
		costUSD:           zeroIfNull(firstNumericExpression(append(tokenUsageFieldPaths("cost_usd"), tokenUsageFieldPaths("total_cost_usd")...), "double")),
	}
}

func cumulativeTokenUsageExpression() cumulativeTokenUsageExpressions {
	present := anyFieldEqualsExpression(payloadFieldPaths("usage_source"), "codex_transcript")
	return cumulativeTokenUsageExpressions{
		present:           bson.D{{Key: "$cond", Value: bson.A{present, 1, 0}}},
		inputTokens:       cumulativeValueExpression(present, firstNumericExpression(tokenUsageFieldPaths("input_tokens"), "long")),
		cachedInputTokens: cumulativeValueExpression(present, firstNumericExpression(append(tokenUsageFieldPaths("cached_input_tokens"), tokenUsageFieldPaths("cached_tokens")...), "long")),
		outputTokens:      cumulativeValueExpression(present, firstNumericExpression(tokenUsageFieldPaths("output_tokens"), "long")),
		reasoningTokens:   cumulativeValueExpression(present, firstNumericExpression(append(tokenUsageFieldPaths("reasoning_tokens"), tokenUsageFieldPaths("reasoning_output_tokens")...), "long")),
		totalTokens:       cumulativeValueExpression(present, firstNumericExpression(tokenUsageFieldPaths("total_tokens"), "long")),
		costUSD:           cumulativeValueExpression(present, firstNumericExpression(append(tokenUsageFieldPaths("cost_usd"), tokenUsageFieldPaths("total_cost_usd")...), "double")),
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
	paths := make([]string, 0, len(containers)*5)
	for _, container := range containers {
		paths = append(paths, payloadFieldPaths(container)...)
	}
	return paths
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
	values := make(bson.A, 0, len(paths))
	for _, path := range paths {
		values = append(values, nonEmptyStringExpression(path))
	}
	return bson.D{{Key: "$or", Value: values}}
}

func anyArrayNonEmptyExpression(paths ...string) bson.D {
	values := make(bson.A, 0, len(paths))
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
	return bson.D{{Key: "$or", Value: values}}
}

func anyFieldEqualsExpression(paths []string, want string) bson.D {
	values := make(bson.A, 0, len(paths))
	for _, path := range paths {
		values = append(values, fieldEqualsExpression(path, want))
	}
	return bson.D{{Key: "$or", Value: values}}
}

func anyRegexFieldExpression(paths []string, regex string) bson.D {
	values := make(bson.A, 0, len(paths))
	for _, path := range paths {
		values = append(values, regexFieldExpression(path, regex))
	}
	return bson.D{{Key: "$or", Value: values}}
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
	return bson.D{{Key: "$let", Value: bson.D{
		{Key: "vars", Value: bson.D{
			{Key: "explicit", Value: firstCandidate("$explicit_title_candidates")},
			{Key: "prompt", Value: firstCandidate("$prompt_title_candidates")},
		}},
		{Key: "in", Value: bson.D{{Key: "$ifNull", Value: bson.A{
			"$$explicit",
			bson.D{{Key: "$ifNull", Value: bson.A{"$$prompt", "$_id"}}},
		}}}},
	}}}
}
