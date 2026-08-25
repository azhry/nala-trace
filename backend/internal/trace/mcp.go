package trace

import "strings"

const mcpToolPrefix = "mcp__"

// MCPServerFromToolName returns the canonical server portion of an MCP tool
// name. Only mcp__<server>__<tool> names are classified; arbitrary tool names
// and incomplete prefixes remain ordinary tools.
func MCPServerFromToolName(toolName string) (string, bool) {
	name := strings.TrimSpace(toolName)
	if len(name) <= len(mcpToolPrefix) || !strings.EqualFold(name[:len(mcpToolPrefix)], mcpToolPrefix) {
		return "", false
	}
	rest := name[len(mcpToolPrefix):]
	separator := strings.Index(rest, "__")
	if separator <= 0 || separator+2 >= len(rest) {
		return "", false
	}
	server := strings.TrimSpace(rest[:separator])
	tool := strings.TrimSpace(rest[separator+2:])
	if server == "" || tool == "" || strings.ContainsAny(server, "\r\n\t") || strings.ContainsAny(tool, "\r\n\t") {
		return "", false
	}
	return strings.ToLower(server), true
}
