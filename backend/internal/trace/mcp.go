package trace

import "strings"

const mcpToolPrefix = "mcp__"
const codexAppsHostNamespace = "codex_apps"

var nonMCPHostNamespaces = map[string]struct{}{
	"node_repl": {},
}

// MCPServerFromToolName returns the canonical server portion of an MCP tool
// name. codex_apps is a host namespace: its tool names encode the underlying
// connector as the first token after the namespace (for example,
// mcp__codex_apps__linear_get_issue belongs to the linear server). Runtime
// namespaces such as node_repl are not MCP servers.
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
	if server == codexAppsHostNamespace {
		if strings.HasPrefix(strings.ToLower(tool), "node_repl_") {
			return "", false
		}
		connectorSeparator := strings.Index(tool, "_")
		if connectorSeparator <= 0 || connectorSeparator+1 >= len(tool) {
			return "", false
		}
		server = strings.ToLower(strings.TrimSpace(tool[:connectorSeparator]))
		tool = strings.TrimSpace(tool[connectorSeparator+1:])
		if server == "" || tool == "" || strings.ContainsAny(server, "\r\n\t") || strings.ContainsAny(tool, "\r\n\t") {
			return "", false
		}
	}
	if _, reserved := nonMCPHostNamespaces[server]; reserved {
		return "", false
	}
	return server, true
}
