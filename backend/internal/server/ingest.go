package server

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/azhry/nala-trace/backend/internal/auth"
	"github.com/azhry/nala-trace/backend/internal/events"
	"github.com/azhry/nala-trace/backend/internal/storage"
)

const maxIngestBodyBytes int64 = 4 << 20

type HookEventInserter interface {
	InsertHookEvent(context.Context, storage.HookEvent) error
}

func NewIngestHandler(repository HookEventInserter) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			WriteError(response, http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
			return
		}
		user, ok := auth.UserFromContext(request.Context())
		if !ok {
			WriteError(response, http.StatusUnauthorized, "unauthenticated", "authentication required")
			return
		}
		body, err := io.ReadAll(io.LimitReader(request.Body, maxIngestBodyBytes+1))
		if err != nil {
			WriteError(response, http.StatusBadRequest, "invalid_event", "request body is invalid")
			return
		}
		if int64(len(body)) > maxIngestBodyBytes {
			WriteError(response, http.StatusRequestEntityTooLarge, "payload_too_large", "request body is too large")
			return
		}
		event, err := events.Decode(body)
		if err != nil {
			WriteError(response, http.StatusBadRequest, "invalid_event", "request body is invalid")
			return
		}
		if repository == nil {
			WriteError(response, http.StatusServiceUnavailable, "ingest_unavailable", "ingestion is unavailable")
			return
		}
		hookEvent, err := storage.NewHookEvent(user.ID, event, time.Now().UTC())
		if err != nil {
			WriteError(response, http.StatusInternalServerError, "ingest_failed", "event could not be stored")
			return
		}
		if err := repository.InsertHookEvent(request.Context(), hookEvent); err != nil {
			WriteError(response, http.StatusInternalServerError, "ingest_failed", "event could not be stored")
			return
		}
		WriteJSON(response, http.StatusAccepted, map[string]bool{"accepted": true})
	})
}
