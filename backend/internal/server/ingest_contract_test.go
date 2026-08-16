package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/azhry/nala-trace/backend/internal/auth"
	"github.com/azhry/nala-trace/backend/internal/config"
	"github.com/azhry/nala-trace/backend/internal/events"
)

func TestIngestContractAcceptsEverySupportedEventFamily(t *testing.T) {
	for _, eventName := range events.SupportedEventNames() {
		t.Run(eventName, func(t *testing.T) {
			repository := &fakeHookEventInserter{}
			request := httptest.NewRequest(http.MethodPost, "/ingest", strings.NewReader(`{"session_id":"session-1","hook_event_name":"`+eventName+`"}`))
			request = request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-1", Tier: auth.TierDeveloper}))
			recorder := httptest.NewRecorder()

			NewIngestHandler(repository).ServeHTTP(recorder, request)

			if recorder.Code != http.StatusAccepted || len(repository.events) != 1 {
				t.Fatalf("event family was not accepted: status=%d inserts=%d body=%q", recorder.Code, len(repository.events), recorder.Body.String())
			}
		})
	}
}

func TestIngestContractKeepsDuplicateDeliveriesAppendOnly(t *testing.T) {
	repository := &fakeHookEventInserter{}
	for range 2 {
		request := httptest.NewRequest(http.MethodPost, "/ingest", strings.NewReader(`{"session_id":"session-1","hook_event_name":"Stop"}`))
		request = request.WithContext(auth.WithUser(request.Context(), auth.User{ID: "user-1", Tier: auth.TierDeveloper}))
		recorder := httptest.NewRecorder()
		NewIngestHandler(repository).ServeHTTP(recorder, request)
		if recorder.Code != http.StatusAccepted {
			t.Fatalf("duplicate delivery status = %d, body=%q", recorder.Code, recorder.Body.String())
		}
	}
	if len(repository.events) != 2 {
		t.Fatalf("duplicate deliveries inserted %d events, want 2", len(repository.events))
	}
}

func TestIngestContractRejectsMissingAndInvalidBearerBeforeInsert(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") == "Bearer invalid" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"authenticated":true,"id":"user-1","tier":"Developer"}`))
	}))
	defer provider.Close()

	cfg := config.Config{AllowedOrigin: "", Auth: config.AuthConfig{NalaLabsAuthURL: provider.URL}}
	repository := &fakeHookEventInserter{}
	handler := NewHandler(ProtectedRoute("/ingest", NewIngestHandler(repository), auth.NewMiddleware(cfg, auth.NewIAMClient(cfg.Auth))))

	for name, authorization := range map[string]string{"missing": "", "invalid": "Bearer invalid"} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/ingest", strings.NewReader(`{"session_id":"session-1","hook_event_name":"Stop"}`))
			if authorization != "" {
				request.Header.Set("Authorization", authorization)
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusUnauthorized || len(repository.events) != 0 {
				t.Fatalf("unauthorized request was not rejected before insert: status=%d inserts=%d body=%q", recorder.Code, len(repository.events), recorder.Body.String())
			}
		})
	}

	valid := httptest.NewRequest(http.MethodPost, "/ingest", strings.NewReader(`{"session_id":"session-1","hook_event_name":"Stop"}`))
	valid.Header.Set("Authorization", "Bearer valid")
	validRecorder := httptest.NewRecorder()
	handler.ServeHTTP(validRecorder, valid)
	if validRecorder.Code != http.StatusAccepted || len(repository.events) != 1 {
		t.Fatalf("valid bearer was not accepted: status=%d inserts=%d body=%q", validRecorder.Code, len(repository.events), validRecorder.Body.String())
	}
}
