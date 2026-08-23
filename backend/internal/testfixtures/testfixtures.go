package testfixtures

import (
	"embed"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/azhry/nala-trace/backend/internal/events"
	"github.com/azhry/nala-trace/backend/internal/storage"
)

const (
	CompleteSession  = "complete_session.json"
	PartialSequences = "partial_sequences.json"

	fixtureUserID = "user-1"
)

//go:embed data/*.json
var fixtureFiles embed.FS

type fixtureRecord struct {
	ID         string          `json:"id"`
	ReceivedAt string          `json:"received_at"`
	Payload    json.RawMessage `json:"payload"`
}

// Load decodes sanitized, raw-shaped hook events through the same event and
// storage boundaries used by ingestion. Fixture timestamps and IDs are
// explicit so reconstruction ordering and response assertions stay stable.
func Load(name string) ([]storage.HookEvent, error) {
	if strings.Contains(name, "..") || strings.ContainsAny(name, `/\\`) {
		return nil, fmt.Errorf("invalid fixture name %q", name)
	}
	data, err := fixtureFiles.ReadFile("data/" + name)
	if err != nil {
		return nil, fmt.Errorf("read fixture %q: %w", name, err)
	}
	var records []fixtureRecord
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, fmt.Errorf("decode fixture %q: %w", name, err)
	}
	result := make([]storage.HookEvent, 0, len(records))
	for index, record := range records {
		if strings.TrimSpace(record.ID) == "" {
			return nil, fmt.Errorf("fixture %q record %d has no id", name, index)
		}
		receivedAt, err := time.Parse(time.RFC3339Nano, record.ReceivedAt)
		if err != nil {
			return nil, fmt.Errorf("fixture %q record %d has invalid received_at: %w", name, index, err)
		}
		event, err := events.Decode(record.Payload)
		if err != nil {
			return nil, fmt.Errorf("fixture %q record %d has invalid hook event: %w", name, index, err)
		}
		hookEvent, err := storage.NewHookEvent(fixtureUserID, event, receivedAt)
		if err != nil {
			return nil, fmt.Errorf("fixture %q record %d cannot become a hook event: %w", name, index, err)
		}
		hookEvent.ID = record.ID
		result = append(result, hookEvent)
	}
	return result, nil
}
