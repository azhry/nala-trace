package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// APIKeyStore validates Nala Labs API keys against the shared API-key table.
// Nala Labs owns key creation and revocation; Nala Trace performs the lookup
// locally so request authentication does not require a per-request HTTP hop.
type APIKeyStore struct {
	db *sql.DB
}

func NewAPIKeyStore(databaseURL string) (*APIKeyStore, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, ErrProviderUnavailable
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, ErrProviderUnavailable
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, ErrProviderUnavailable
	}
	return &APIKeyStore{db: db}, nil
}

func (s *APIKeyStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *APIKeyStore) Validate(ctx context.Context, rawKey string) (User, error) {
	if s == nil || s.db == nil {
		return User{}, ErrProviderUnavailable
	}
	rawKey = strings.TrimSpace(rawKey)
	if rawKey == "" || len(rawKey) > 512 {
		return User{}, ErrUnauthenticated
	}
	digest := sha256.Sum256([]byte(rawKey))
	var ownerID, userName, userEmail, userTier string
	err := s.db.QueryRowContext(ctx, `
		SELECT owner_id, user_name, user_email, user_tier
		FROM api_key
		WHERE key_digest = $1`, digest[:]).Scan(&ownerID, &userName, &userEmail, &userTier)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUnauthenticated
	}
	if err != nil {
		return User{}, ErrProviderUnavailable
	}
	user := User{
		ID:    strings.TrimSpace(ownerID),
		Name:  strings.TrimSpace(userName),
		Email: strings.TrimSpace(userEmail),
		Tier:  storedTier(userTier),
	}
	if !user.Valid() {
		return User{}, ErrUnauthenticated
	}
	return user, nil
}

func storedTier(value string) Tier {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "admin":
		return TierAdmin
	case "developer":
		return TierDeveloper
	default:
		return TierFree
	}
}
