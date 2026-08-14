//go:build integration

package storage

import (
	"context"
	"os"
	"testing"
)

func TestLiveMongoStore(t *testing.T) {
	if os.Getenv("NALA_TRACE_RUN_LIVE_MONGO") != "1" {
		t.Skip("set NALA_TRACE_RUN_LIVE_MONGO=1 to run against a real MongoDB service")
	}

	cfg := testMongoConfig()
	if value := os.Getenv("MONGO_URI"); value != "" {
		cfg.URI = value
	}
	if value := os.Getenv("MONGO_DATABASE"); value != "" {
		cfg.Database = value
	}
	store, err := NewMongoStore(context.Background(), cfg)
	if err != nil {
		t.Fatalf("live Mongo lifecycle failed: %v", err)
	}
	if store == nil {
		t.Fatal("live Mongo lifecycle returned no store")
	}
	if err := store.Close(context.Background()); err != nil {
		t.Fatalf("live Mongo shutdown failed: %v", err)
	}
}
