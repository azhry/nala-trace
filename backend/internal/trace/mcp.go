package trace

import "strings"

const mcpToolPrefix = "mcp__"

var nonMCPHostNamespaces = map[string]struct{}{
	"codex_apps": {},
	"node_repl":  {},
}

// MCPServerFromToolName returns the canonical server portion of an MCP tool
// name. Host namespaces used by the Codex runtime are not MCP servers, even
// when their tool names use the mcp__ prefix.
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
	server = strings.ToLower(server)
	if _, reserved := nonMCPHostNamespaces[server]; reserved {
		return "", false
	}
	return server, true
}
