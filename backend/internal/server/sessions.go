package server

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/azhry/nala-trace/backend/internal/auth"
	"github.com/azhry/nala-trace/backend/internal/reconstruction"
	"github.com/azhry/nala-trace/backend/internal/storage"
	"github.com/azhry/nala-trace/backend/internal/trace"
)

const defaultSessionLimit = 100

type SessionSummaryReader interface {
	ListSessionSummariesForUser(context.Context, string, int) ([]storage.SessionSummary, error)
}

type SessionEventReader interface {
	ListSessionEventsForUser(context.Context, string, string) ([]storage.HookEvent, error)
}

func NewSessionsHandler(repository SessionSummaryReader) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			WriteError(response, http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
			return
		}
		user, ok := auth.UserFromContext(request.Context())
		if !ok {
			WriteError(response, http.StatusUnauthorized, "unauthenticated", "authentication required")
			return
		}
		limit, err := parseSessionLimit(request)
		if err != nil {
			WriteError(response, http.StatusBadRequest, "invalid_query", "query parameters are invalid")
			return
		}
		if repository == nil {
			WriteError(response, http.StatusServiceUnavailable, "sessions_unavailable", "sessions are unavailable")
			return
		}
		rows, err := repository.ListSessionSummariesForUser(request.Context(), user.ID, limit)
		if err != nil {
			WriteError(response, http.StatusInternalServerError, "sessions_failed", "sessions could not be loaded")
			return
		}
		if rows == nil {
			rows = make([]storage.SessionSummary, 0)
		}
		WriteJSON(response, http.StatusOK, struct {
			Sessions []storage.SessionSummary `json:"sessions"`
			Limit    int                      `json:"limit"`
		}{Sessions: rows, Limit: limit})
	})
}

func NewSessionTraceHandler(repository SessionEventReader, analysisReaders ...storage.SessionAnalysisReader) http.Handler {
	var analysisReader storage.SessionAnalysisReader
	if len(analysisReaders) > 0 {
		analysisReader = analysisReaders[0]
	}
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			WriteError(response, http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
			return
		}
		user, ok := auth.UserFromContext(request.Context())
		if !ok {
			WriteError(response, http.StatusUnauthorized, "unauthenticated", "authentication required")
			return
		}
		sessionID := sessionIDFromPath(request.URL.Path)
		if sessionID == "" {
			WriteError(response, http.StatusNotFound, "trace_not_found", "session trace was not found")
			return
		}
		if repository == nil {
			WriteError(response, http.StatusServiceUnavailable, "trace_unavailable", "session trace is unavailable")
			return
		}
		events, err := repository.ListSessionEventsForUser(request.Context(), user.ID, sessionID)
		if err != nil {
			WriteError(response, http.StatusInternalServerError, "trace_failed", "session trace could not be loaded")
			return
		}
		if len(events) == 0 {
			WriteError(response, http.StatusNotFound, "trace_not_found", "session trace was not found")
			return
		}
		result := reconstruction.Reconstruct(sessionID, user.ID, events)
		if analysisReader != nil {
			analysis, err := analysisReader.GetSessionAnalysisForUser(request.Context(), user.ID, sessionID)
			if err != nil {
				WriteError(response, http.StatusInternalServerError, "analysis_failed", "session analysis could not be loaded")
				return
			}
			result.Analysis = analysis
		} else {
			result.Analysis = trace.NewAnalysis()
		}
		WriteJSON(response, http.StatusOK, result)
	})
}

func sessionIDFromPath(requestPath string) string {
	const prefix = "/sessions/"
	if !strings.HasPrefix(requestPath, prefix) {
		return ""
	}
	id := strings.Trim(strings.TrimPrefix(requestPath, prefix), "/")
	if id == "" || strings.Contains(id, "/") {
		return ""
	}
	return id
}

func parseSessionLimit(request *http.Request) (int, error) {
	values := request.URL.Query()
	for key := range values {
		if key != "limit" {
			return 0, strconv.ErrSyntax
		}
	}
	if values.Get("limit") == "" {
		return defaultSessionLimit, nil
	}
	if len(values["limit"]) != 1 {
		return 0, strconv.ErrSyntax
	}
	limit, err := strconv.Atoi(values.Get("limit"))
	if err != nil || limit < 1 || limit > defaultSessionLimit {
		return 0, strconv.ErrSyntax
	}
	return limit, nil
}
