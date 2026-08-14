package storage

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/config"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

type fakeMongoClient struct {
	connectErr     error
	pingErr        error
	connectWait    bool
	pingWait       bool
	disconnectWait bool
	connected      bool
	disconnected   bool
}

func (f *fakeMongoClient) Connect(ctx context.Context) error {
	if f.connectWait {
		<-ctx.Done()
		return ctx.Err()
	}
	if f.connectErr == nil {
		f.connected = true
	}
	return f.connectErr
}

func (f *fakeMongoClient) Ping(ctx context.Context, _ *readpref.ReadPref) error {
	if f.pingWait {
		<-ctx.Done()
		return ctx.Err()
	}
	return f.pingErr
}

func (f *fakeMongoClient) Disconnect(ctx context.Context) error {
	if f.disconnectWait {
		<-ctx.Done()
		return ctx.Err()
	}
	f.disconnected = true
	return nil
}

func testMongoConfig() config.MongoConfig {
	return config.MongoConfig{
		Enabled:           true,
		URI:               "mongodb://localhost:27017",
		Database:          "nala_trace",
		ConnectTimeout:    50 * time.Millisecond,
		PingTimeout:       50 * time.Millisecond,
		DisconnectTimeout: 50 * time.Millisecond,
	}
}

func TestNewMongoStoreDisabled(t *testing.T) {
	store, err := NewMongoStore(context.Background(), config.MongoConfig{})
	if err != nil || store != nil {
		t.Fatalf("disabled Mongo should be a no-op, store=%v err=%v", store, err)
	}
}

func TestNewMongoStoreMissingConfiguration(t *testing.T) {
	cfg := testMongoConfig()
	cfg.URI = ""
	_, err := NewMongoStore(context.Background(), cfg)
	var lifecycleErr *LifecycleError
	if !errors.As(err, &lifecycleErr) || lifecycleErr.Code != "mongo_config_missing_uri" {
		t.Fatalf("unexpected missing config error: %v", err)
	}
}

func TestNewMongoStoreSuccessAndClose(t *testing.T) {
	cfg := testMongoConfig()
	fake := &fakeMongoClient{}
	store, err := newMongoStore(context.Background(), cfg, func(context.Context, *options.ClientOptions) (mongoClient, error) {
		return fake, nil
	})
	if err != nil || store == nil || !fake.connected {
		t.Fatalf("expected connected store, store=%v err=%v", store, err)
	}
	if err := store.Close(context.Background()); err != nil || !fake.disconnected {
		t.Fatalf("expected clean disconnect, disconnected=%v err=%v", fake.disconnected, err)
	}
}

func TestNewMongoStorePingTimeoutIsBoundedAndCloses(t *testing.T) {
	cfg := testMongoConfig()
	cfg.PingTimeout = 10 * time.Millisecond
	fake := &fakeMongoClient{pingWait: true}
	start := time.Now()
	_, err := newMongoStore(context.Background(), cfg, func(context.Context, *options.ClientOptions) (mongoClient, error) {
		return fake, nil
	})
	if time.Since(start) > 500*time.Millisecond {
		t.Fatalf("ping exceeded bounded timeout: %s", time.Since(start))
	}
	var lifecycleErr *LifecycleError
	if !errors.As(err, &lifecycleErr) || lifecycleErr.Code != "mongo_ping" {
		t.Fatalf("unexpected ping error: %v", err)
	}
	if !fake.disconnected {
		t.Fatal("failed ping must disconnect the client")
	}
}

func TestStoreCloseTimeoutIsBounded(t *testing.T) {
	fake := &fakeMongoClient{disconnectWait: true}
	store := &Store{client: fake, disconnectTimeout: 10 * time.Millisecond}
	start := time.Now()
	err := store.Close(context.Background())
	if time.Since(start) > 500*time.Millisecond {
		t.Fatalf("disconnect exceeded bounded timeout: %s", time.Since(start))
	}
	var lifecycleErr *LifecycleError
	if !errors.As(err, &lifecycleErr) || lifecycleErr.Code != "mongo_disconnect" {
		t.Fatalf("unexpected disconnect error: %v", err)
	}
}
