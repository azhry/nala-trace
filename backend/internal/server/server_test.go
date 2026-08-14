package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewHandlerRegistersRoutesAndJSONNotFound(t *testing.T) {
	handler := NewHandler(Route{
		Pattern: "/registered",
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		}),
	})

	registered := httptest.NewRecorder()
	handler.ServeHTTP(registered, httptest.NewRequest(http.MethodGet, "/registered", nil))
	if registered.Code != http.StatusOK || registered.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("unexpected registered response: %d %s", registered.Code, registered.Header().Get("Content-Type"))
	}

	notFound := httptest.NewRecorder()
	handler.ServeHTTP(notFound, httptest.NewRequest(http.MethodGet, "/missing", nil))
	if notFound.Code != http.StatusNotFound || notFound.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("unexpected not-found response: %d %s", notFound.Code, notFound.Header().Get("Content-Type"))
	}
	if body := notFound.Body.String(); body == "" || body[0] != '{' {
		t.Fatalf("expected JSON error body, got %q", body)
	}
}
