package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/azhry/nala-trace/backend/internal/auth"
)

const TraceHandoffRedeemPath = "/api/auth/trace-handoff/redeem"

const maxTraceHandoffRequestSize = 4096

type TraceHandoffRedeemer interface {
	RedeemTraceHandoff(context.Context, string, string) (string, error)
}

func NewTraceHandoffRedeemHandler(redeemer TraceHandoffRedeemer, traceOrigin string) http.Handler {
	normalizedTraceOrigin := auth.NormalizeTraceOrigin(traceOrigin)
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			WriteError(response, http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
			return
		}
		if redeemer == nil {
			WriteError(response, http.StatusServiceUnavailable, "auth_provider_unavailable", "authentication provider unavailable")
			return
		}
		if normalizedTraceOrigin == "" {
			WriteError(response, http.StatusServiceUnavailable, "auth_provider_unavailable", "authentication provider unavailable")
			return
		}

		var input struct {
			Code string `json:"code"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(response, request.Body, maxTraceHandoffRequestSize))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil || strings.TrimSpace(input.Code) == "" {
			WriteError(response, http.StatusBadRequest, "invalid_handoff_code", "authentication handoff code is invalid")
			return
		}
		var extra any
		if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
			WriteError(response, http.StatusBadRequest, "invalid_handoff_code", "authentication handoff code is invalid")
			return
		}

		token, err := redeemer.RedeemTraceHandoff(request.Context(), strings.TrimSpace(input.Code), normalizedTraceOrigin)
		if err != nil {
			switch {
			case errors.Is(err, auth.ErrHandoffRejected), errors.Is(err, auth.ErrUnauthenticated):
				WriteError(response, http.StatusUnauthorized, "invalid_handoff_code", "authentication handoff code is invalid")
			default:
				WriteError(response, http.StatusServiceUnavailable, "auth_provider_unavailable", "authentication provider unavailable")
			}
			return
		}
		if strings.TrimSpace(token) == "" {
			WriteError(response, http.StatusServiceUnavailable, "auth_provider_unavailable", "authentication provider unavailable")
			return
		}
		WriteJSON(response, http.StatusOK, struct {
			Token string `json:"token"`
		}{Token: token})
	})
}
