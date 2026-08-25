package trace

import "testing"

func TestMCPServerFromToolName(t *testing.T) {
	tests := []struct {
		name       string
		tool       string
		wantServer string
		wantOK     bool
	}{
		{name: "server with underscore", tool: "mcp__codex_apps__linear_get_issue", wantServer: "codex_apps", wantOK: true},
		{name: "case normalized", tool: "MCP__GitHub__Create_Issue", wantServer: "github", wantOK: true},
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
