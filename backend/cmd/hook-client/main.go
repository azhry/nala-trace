package main

import (
	"context"
	"os"

	"github.com/azhry/nala-trace/backend/internal/hookclient"
)

func main() {
	// Hook delivery is best effort. Codex must continue even when the
	// observability endpoint is unavailable, misconfigured, or rejects input.
	// Keep the detailed error contract in hookclient.Send for unit callers, but
	// never turn it into a process failure at the hook boundary.
	cfg, err := hookclient.ConfigFromEnv(os.Getenv)
	if err != nil {
		return
	}
	_ = hookclient.Send(context.Background(), os.Stdin, cfg)
}
