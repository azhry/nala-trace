package main

import (
	"context"
	"os"

	"github.com/azhry/nala-trace/backend/internal/hookclient"
)

func main() {
	cfg, err := hookclient.ConfigFromEnv(os.Getenv)
	if err == nil {
		err = hookclient.Send(context.Background(), os.Stdin, cfg)
	}
	if err != nil {
		os.Exit(1)
	}
}
