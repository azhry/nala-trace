package server

import (
	"context"
	"errors"
	"net/http"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/azhry/nala-trace/backend/internal/auth"
	"github.com/azhry/nala-trace/backend/internal/reconstruction"
	"github.com/azhry/nala-trace/backend/internal/storage"
)

const (
	defaultSessionLimit                     = 100
	maxSessionSummaryFeatureWorkers         = 16
	sessionSummaryFeatureEventQueueCapacity = 256
)

type SessionSummaryReader interface {
	ListSessionSummariesForUser(context.Context, string, int) ([]storage.SessionSummary, error)
}

type SessionSummaryWindowReader interface {
	ListRecentSessionIDsForUser(context.Context, string, int) ([]string, error)
	ListSessionSummariesForUserSessions(context.Context, string, []string, int) ([]storage.SessionSummary, error)
}

type SessionSummaryEventsReader interface {
	WalkSessionSummaryEventsForUser(context.Context, string, []string, func(storage.HookEvent) error) error
}

type SessionSummaryFeatureEventsReader interface {
	WalkSessionSummaryFeatureEventsForUser(context.Context, string, []string, func(storage.HookEvent) error) error
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
		var rows []storage.SessionSummary
		featureReader, hasFeatureReader := repository.(SessionSummaryFeatureEventsReader)
		windowReader, hasWindowReader := repository.(SessionSummaryWindowReader)
		if hasWindowReader && hasFeatureReader {
			rows, err = listSessionSummaryWindowWithFeatures(request.Context(), user.ID, limit, windowReader, featureReader)
		} else {
			rows, err = repository.ListSessionSummariesForUser(request.Context(), user.ID, limit)
			if err == nil && rows == nil {
				rows = make([]storage.SessionSummary, 0)
			}
			if err == nil && hasFeatureReader && len(rows) > 0 {
				sessionIDs := make([]string, 0, len(rows))
				for _, row := range rows {
					sessionIDs = append(sessionIDs, row.SessionID)
				}
				var features map[string]reconstruction.SessionSummaryFeatures
				features, err = accumulateSessionSummaryFeatures(request.Context(), featureReader, user.ID, sessionIDs)
				if err == nil {
					mergeSessionSummaryFeatures(rows, features)
				}
			} else if err == nil && !hasWindowReader {
				if eventReader, ok := repository.(SessionSummaryEventsReader); ok && len(rows) > 0 {
					accumulators := make(map[string]*reconstruction.SessionSummaryAccumulator, len(rows))
					sessionIDs := make([]string, 0, len(rows))
					for _, row := range rows {
						accumulators[row.SessionID] = reconstruction.NewSessionSummaryAccumulator()
						sessionIDs = append(sessionIDs, row.SessionID)
					}
					if err := eventReader.WalkSessionSummaryEventsForUser(request.Context(), user.ID, sessionIDs, func(event storage.HookEvent) error {
						accumulator, exists := accumulators[event.SessionID]
						if exists {
							accumulator.Add(event)
						}
						return nil
					}); err != nil {
						WriteError(response, http.StatusInternalServerError, "sessions_failed", "sessions could not be loaded")
						return
					}
					for index := range rows {
						features := accumulators[rows[index].SessionID].Result(rows[index].SessionID)
						rows[index].Title = features.Title
						rows[index].MCPCallCount = features.MCPCallCount
						rows[index].MCPServers = features.MCPServers
						rows[index].SkillInvocationCount = features.SkillInvocationCount
						rows[index].FileOperationCount = features.FileOperationCount
						rows[index].FileReadCount = features.FileReadCount
						rows[index].TokenUsage = features.TokenUsage
					}
				}
			}
		}
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

func accumulateSessionSummaryFeatures(ctx context.Context, reader SessionSummaryFeatureEventsReader, userID string, sessionIDs []string) (map[string]reconstruction.SessionSummaryFeatures, error) {
	workers := runtime.GOMAXPROCS(0)
	if workers > maxSessionSummaryFeatureWorkers {
		workers = maxSessionSummaryFeatureWorkers
	}
	if workers < 1 {
		workers = 1
	}
	accumulators := make([]map[string]*reconstruction.SessionSummaryAccumulator, workers)
	for worker := range accumulators {
		accumulators[worker] = make(map[string]*reconstruction.SessionSummaryAccumulator, len(sessionIDs))
		for _, sessionID := range sessionIDs {
			accumulators[worker][sessionID] = reconstruction.NewSessionSummaryAccumulator()
		}
	}
	events := make(chan storage.HookEvent, sessionSummaryFeatureEventQueueCapacity)
	var wait sync.WaitGroup
	wait.Add(workers)
	for worker := range accumulators {
		go func(worker int) {
			defer wait.Done()
			for event := range events {
				if accumulator, exists := accumulators[worker][event.SessionID]; exists {
					accumulator.AddPreToolFeature(event)
				}
			}
		}(worker)
	}

	walkErr := reader.WalkSessionSummaryFeatureEventsForUser(ctx, userID, sessionIDs, func(event storage.HookEvent) error {
		// The cursor advances after this callback, so retain the raw payload while a worker processes it.
		event.Payload = append(event.Payload[:0:0], event.Payload...)
		select {
		case events <- event:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	})
	close(events)
	wait.Wait()
	if walkErr != nil {
		return nil, walkErr
	}

	merged := make(map[string]reconstruction.SessionSummaryFeatures, len(sessionIDs))
	serverSets := make(map[string]map[string]struct{}, len(sessionIDs))
	for _, sessionID := range sessionIDs {
		merged[sessionID] = reconstruction.SessionSummaryFeatures{MCPServers: make([]string, 0)}
		serverSets[sessionID] = make(map[string]struct{})
	}
	for _, workerAccumulators := range accumulators {
		for sessionID, accumulator := range workerAccumulators {
			part := accumulator.Result(sessionID)
			combined := merged[sessionID]
			combined.MCPCallCount += part.MCPCallCount
			combined.SkillInvocationCount += part.SkillInvocationCount
			combined.FileOperationCount += part.FileOperationCount
			combined.FileReadCount += part.FileReadCount
			for _, server := range part.MCPServers {
				serverSets[sessionID][server] = struct{}{}
			}
			merged[sessionID] = combined
		}
	}
	for sessionID, servers := range serverSets {
		combined := merged[sessionID]
		for server := range servers {
			combined.MCPServers = append(combined.MCPServers, server)
		}
		sort.Strings(combined.MCPServers)
		merged[sessionID] = combined
	}
	return merged, nil
}

func listSessionSummaryWindowWithFeatures(ctx context.Context, userID string, limit int, summaryReader SessionSummaryWindowReader, featureReader SessionSummaryFeatureEventsReader) ([]storage.SessionSummary, error) {
	sessionIDs, err := summaryReader.ListRecentSessionIDsForUser(ctx, userID, limit)
	if err != nil {
		return nil, err
	}
	if len(sessionIDs) == 0 {
		return make([]storage.SessionSummary, 0), nil
	}

	readContext, cancel := context.WithCancel(ctx)
	defer cancel()
	var rows []storage.SessionSummary
	var features map[string]reconstruction.SessionSummaryFeatures
	var rowsErr error
	var featuresErr error
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		rows, rowsErr = summaryReader.ListSessionSummariesForUserSessions(readContext, userID, sessionIDs, limit)
		if rowsErr != nil {
			cancel()
		}
	}()
	go func() {
		defer wait.Done()
		features, featuresErr = accumulateSessionSummaryFeatures(readContext, featureReader, userID, sessionIDs)
		if featuresErr != nil {
			cancel()
		}
	}()
	wait.Wait()
	if rowsErr != nil && !errors.Is(rowsErr, context.Canceled) {
		return nil, rowsErr
	}
	if featuresErr != nil && !errors.Is(featuresErr, context.Canceled) {
		return nil, featuresErr
	}
	if rowsErr != nil {
		return nil, rowsErr
	}
	if featuresErr != nil {
		return nil, featuresErr
	}
	if rows == nil {
		rows = make([]storage.SessionSummary, 0)
	}
	mergeSessionSummaryFeatures(rows, features)
	return rows, nil
}

func mergeSessionSummaryFeatures(rows []storage.SessionSummary, features map[string]reconstruction.SessionSummaryFeatures) {
	for index := range rows {
		if summaryFeatures, exists := features[rows[index].SessionID]; exists {
			rows[index].MCPCallCount = summaryFeatures.MCPCallCount
			rows[index].MCPServers = summaryFeatures.MCPServers
			rows[index].SkillInvocationCount = summaryFeatures.SkillInvocationCount
			rows[index].FileOperationCount = summaryFeatures.FileOperationCount
			rows[index].FileReadCount = summaryFeatures.FileReadCount
		}
	}
}

func listSessionSummaryWindow(ctx context.Context, userID string, limit int, summaryReader SessionSummaryWindowReader, eventReader SessionSummaryEventsReader) ([]storage.SessionSummary, error) {
	sessionIDs, err := summaryReader.ListRecentSessionIDsForUser(ctx, userID, limit)
	if err != nil {
		return nil, err
	}
	if len(sessionIDs) == 0 {
		return make([]storage.SessionSummary, 0), nil
	}
	if eventReader == nil {
		return summaryReader.ListSessionSummariesForUserSessions(ctx, userID, sessionIDs, limit)
	}

	accumulators := make(map[string]*reconstruction.SessionSummaryAccumulator, len(sessionIDs))
	for _, sessionID := range sessionIDs {
		accumulators[sessionID] = reconstruction.NewSessionSummaryAccumulator()
	}
	readContext, cancel := context.WithCancel(ctx)
	defer cancel()

	var rows []storage.SessionSummary
	var rowsErr error
	var eventsErr error
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		rows, rowsErr = summaryReader.ListSessionSummariesForUserSessions(readContext, userID, sessionIDs, limit)
		if rowsErr != nil {
			cancel()
		}
	}()
	go func() {
		defer wait.Done()
		eventsErr = eventReader.WalkSessionSummaryEventsForUser(readContext, userID, sessionIDs, func(event storage.HookEvent) error {
			if accumulator, exists := accumulators[event.SessionID]; exists {
				accumulator.Add(event)
			}
			return nil
		})
		if eventsErr != nil {
			cancel()
		}
	}()
	wait.Wait()
	if rowsErr != nil {
		return nil, rowsErr
	}
	if eventsErr != nil {
		return nil, eventsErr
	}
	if rows == nil {
		rows = make([]storage.SessionSummary, 0)
	}
	for index := range rows {
		if accumulator, exists := accumulators[rows[index].SessionID]; exists {
			features := accumulator.Result(rows[index].SessionID)
			rows[index].Title = features.Title
			rows[index].MCPCallCount = features.MCPCallCount
			rows[index].MCPServers = features.MCPServers
			rows[index].SkillInvocationCount = features.SkillInvocationCount
			rows[index].FileOperationCount = features.FileOperationCount
			rows[index].FileReadCount = features.FileReadCount
			rows[index].TokenUsage = features.TokenUsage
		}
	}
	return rows, nil
}

func NewSessionTraceHandler(repository SessionEventReader) http.Handler {
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
		WriteJSON(response, http.StatusOK, reconstruction.Reconstruct(sessionID, user.ID, events))
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
