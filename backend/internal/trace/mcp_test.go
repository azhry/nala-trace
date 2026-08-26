package trace

import "testing"

func TestMCPServerFromToolName(t *testing.T) {
	tests := []struct {
		name       string
		tool       string
		wantServer string
		wantOK     bool
	}{
		{name: "server with underscore", tool: "mcp__my_server__get_issue", wantServer: "my_server", wantOK: true},
		{name: "case normalized", tool: "MCP__GitHub__Create_Issue", wantServer: "github", wantOK: true},
		{name: "codex apps connector", tool: "mcp__codex_apps__linear_get_issue", wantServer: "linear", wantOK: true},
		{name: "codex apps github connector", tool: "mcp__codex_apps__github_add_comment_to_issue", wantServer: "github", wantOK: true},
		{name: "codex apps connector missing operation", tool: "mcp__codex_apps__linear", wantOK: false},
		{name: "codex apps node repl connector", tool: "mcp__codex_apps__node_repl_js", wantOK: false},
		{name: "node repl host namespace", tool: "mcp__node_repl__js", wantOK: false},
		{name: "missing server", tool: "mcp____tool", wantOK: false},
		{name: "missing tool", tool: "mcp__server__", wantOK: false},
		{name: "ordinary tool", tool: "shell_command", wantOK: false},
		{name: "near miss", tool: "mcp__server_tool", wantOK: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, ok := MCPServerFromToolName(test.tool)
			if server != test.wantServer || ok != test.wantOK {
				t.Fatalf("MCPServerFromToolName(%q) = (%q, %t), want (%q, %t)", test.tool, server, ok, test.wantServer, test.wantOK)
			}
		})
	}
}
