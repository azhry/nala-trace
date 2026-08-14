package storage

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/azhry/nala-trace/backend/internal/config"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"
)

type mongoClient interface {
	Connect(context.Context) error
	Ping(context.Context, *readpref.ReadPref) error
	Disconnect(context.Context) error
}

type clientFactory func(context.Context, *options.ClientOptions) (mongoClient, error)

type Store struct {
	client            mongoClient
	database          *mongo.Database
	disconnectTimeout time.Duration
}

type LifecycleError struct {
	Code string
}

func (e *LifecycleError) Error() string {
	return fmt.Sprintf("%s: mongo dependency unavailable", e.Code)
}

// NewMongoStore creates and validates a Mongo client when the subsystem is
// enabled. Every network operation is bounded by the corresponding config
// duration, and returned errors never include the connection string.
func NewMongoStore(ctx context.Context, cfg config.MongoConfig) (*Store, error) {
	return newMongoStore(ctx, cfg, func(_ context.Context, opts *options.ClientOptions) (mongoClient, error) {
		return mongo.NewClient(opts)
	})
}

func newMongoStore(ctx context.Context, cfg config.MongoConfig, factory clientFactory) (*Store, error) {
	if !cfg.Enabled {
		return nil, nil
	}
	if strings.TrimSpace(cfg.URI) == "" {
		return nil, &LifecycleError{Code: "mongo_config_missing_uri"}
	}
	if strings.TrimSpace(cfg.Database) == "" {
		return nil, &LifecycleError{Code: "mongo_config_missing_database"}
	}
	if cfg.ConnectTimeout <= 0 || cfg.PingTimeout <= 0 || cfg.DisconnectTimeout <= 0 {
		return nil, &LifecycleError{Code: "mongo_config_invalid_timeout"}
	}
	if err := validateURI(cfg.URI); err != nil {
		return nil, &LifecycleError{Code: "mongo_config_invalid_uri"}
	}
	clientOptions := options.Client().ApplyURI(cfg.URI)
	connectCtx, cancelConnect := context.WithTimeout(ctx, cfg.ConnectTimeout)
	defer cancelConnect()
	client, err := factory(connectCtx, clientOptions)
	if err != nil {
		return nil, &LifecycleError{Code: "mongo_client_create"}
	}

	if err := client.Connect(connectCtx); err != nil {
		return nil, &LifecycleError{Code: "mongo_connect"}
	}

	pingCtx, cancelPing := context.WithTimeout(ctx, cfg.PingTimeout)
	defer cancelPing()
	if err := client.Ping(pingCtx, readpref.Primary()); err != nil {
		closeCtx, cancelClose := context.WithTimeout(context.Background(), cfg.DisconnectTimeout)
		_ = client.Disconnect(closeCtx)
		cancelClose()
		return nil, &LifecycleError{Code: "mongo_ping"}
	}

	return &Store{
		client:            client,
		database:          clientDatabase(client, cfg.Database),
		disconnectTimeout: cfg.DisconnectTimeout,
	}, nil
}

// Close disconnects the client with a bounded context. It is safe to call on
// a nil store so shutdown paths can be composed without special cases.
func (s *Store) Close(ctx context.Context) error {
	if s == nil || s.client == nil {
		return nil
	}
	closeCtx, cancel := context.WithTimeout(ctx, s.disconnectTimeout)
	defer cancel()
	if err := s.client.Disconnect(closeCtx); err != nil {
		return &LifecycleError{Code: "mongo_disconnect"}
	}
	return nil
}

// Ping verifies that the initialized Mongo client can still reach its primary.
// The caller owns the timeout and the returned error never includes the URI.
func (s *Store) Ping(ctx context.Context) error {
	if s == nil || s.client == nil {
		return &LifecycleError{Code: "mongo_not_configured"}
	}
	if err := s.client.Ping(ctx, readpref.Primary()); err != nil {
		return &LifecycleError{Code: "mongo_ping"}
	}
	return nil
}

func (s *Store) Database() *mongo.Database {
	if s == nil {
		return nil
	}
	return s.database
}

// mongo.Database is tied to the concrete mongo.Client. Keeping the helper
// isolated makes the lifecycle's test seam independent from database calls.
func clientDatabase(client mongoClient, name string) *mongo.Database {
	if concrete, ok := client.(*mongo.Client); ok {
		return concrete.Database(name)
	}
	return nil
}

func validateURI(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "mongodb" && parsed.Scheme != "mongodb+srv") || parsed.Host == "" {
		return fmt.Errorf("invalid Mongo URI")
	}
	return nil
}
