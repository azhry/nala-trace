package storage

import (
	"time"

	"go.mongodb.org/mongo-driver/bson"
)

type SessionSummary struct {
	SessionID            string    `bson:"session_id" json:"session_id"`
	Title                string    `bson:"title" json:"title"`
	UserID               string    `bson:"user_id" json:"user_id"`
	FirstEventAt         time.Time `bson:"first_event_at" json:"first_event_at"`
	LastEventAt          time.Time `bson:"last_event_at" json:"last_event_at"`
	EventCount           int64     `bson:"event_count" json:"event_count"`
	ToolCallCount        int64     `bson:"tool_call_count" json:"tool_call_count"`
	MCPCallCount         int64     `bson:"mcp_call_count" json:"mcp_call_count"`
	MCPServers           []string  `bson:"mcp_servers" json:"mcp_servers"`
	SkillInvocationCount int64     `bson:"skill_invocation_count" json:"skill_invocation_count"`
	FileOperationCount   int64     `bson:"file_operation_count" json:"file_operation_count"`
	FileReadCount        int64     `bson:"file_read_count" json:"file_read_count"`
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
	}}}
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
	return anyRegexFieldExpression(append([]string{"$tool_name"}, payloadFieldPaths("tool_name")...), `^mcp__.+__.+$`)
}

func mcpToolNameExpression() bson.D {
	return firstMatchingString(bson.A{
		stringFieldCandidate("$tool_name"),
		stringFieldCandidate("$payload.tool_name"),
		stringFieldCandidate("$payload.payload.tool_name"),
		stringFieldCandidate("$payload.raw.tool_name"),
		stringFieldCandidate("$payload.data.tool_name"),
		stringFieldCandidate("$payload.event.tool_name"),
	}, `^mcp__.+__.+$`)
}

func mcpServerExpression() bson.D {
	name := mcpToolNameExpression()
	separator := bson.D{{Key: "$indexOfCP", Value: bson.A{name, "__", 5}}}
	return bson.D{{Key: "$toLower", Value: bson.D{{Key: "$substrCP", Value: bson.A{
		name,
		5,
		bson.D{{Key: "$subtract", Value: bson.A{separator, 5}}},
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
