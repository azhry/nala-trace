package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/storage"
	"github.com/azhry/nala-trace/backend/internal/trace"
)

type analysisWriter struct {
	annotation      trace.AnnotationResult
	evaluation      trace.EvaluationResult
	userID          string
	sessionID       string
	annotationCalls int
	evaluationCalls int
	err             error
}

func (writer *analysisWriter) SaveAnnotations(_ context.Context, userID, sessionID string, annotation trace.AnnotationResult) (trace.Analysis, error) {
	writer.userID, writer.sessionID, writer.annotation = userID, sessionID, annotation
	writer.annotationCalls++
	if writer.err != nil {
		return trace.Analysis{}, writer.err
	}
	updatedAt := time.Date(2026, 8, 28, 0, 0, 0, 0, time.UTC)
	return trace.Analysis{Annotation: &writer.annotation, UpdatedAt: &updatedAt}, nil
}

func (writer *analysisWriter) SaveEvaluation(_ context.Context, userID, sessionID string, evaluation trace.EvaluationResult) (trace.Analysis, error) {
	writer.userID, writer.sessionID, writer.evaluation = userID, sessionID, evaluation
	writer.evaluationCalls++
	if writer.err != nil {
		return trace.Analysis{}, writer.err
	}
	updatedAt := time.Date(2026, 8, 28, 0, 0, 0, 0, time.UTC)
	return trace.Analysis{Evaluation: &writer.evaluation, UpdatedAt: &updatedAt}, nil
}

func validAnnotationJSON() string {
	return `{"schema_version":"1","source":"session-annotator","turns":[{"event_id":"event-1","follows_instructions":"yes","performance":"neutral","rationale":"Visible evidence supports the labels."}],"tools":[],"skills":[]}`
}

func validEvaluationJSON() string {
	return `{"schema_version":"1","source":"session-evaluator","verdict":"pass","critique":"Visible evidence supports the result.","review_signals":[],"judge_alignment":{"status":"not_recorded"},"evaluation_ledger":{"project":"nala-trace","improvements":[]}}`
}

func TestSessionAnnotationHandlerPersistsOwnerScopedResult(t *testing.T) {
	writer := &analysisWriter{}
	request := authenticatedTraceRequest(http.MethodPost, "/sessions/session-1/annotations")
	request.Body = httptest.NewRequest(http.MethodPost, request.URL.Path, strings.NewReader(validAnnotationJSON())).Body
	response := httptest.NewRecorder()

	NewSessionAnnotationHandler(writer).ServeHTTP(response, request)

	if response.Code != http.StatusOK || writer.userID != "user-1" || writer.sessionID != "session-1" || writer.annotationCalls != 1 {
		t.Fatalf("status = %d, writer = %#v, body = %s", response.Code, writer, response.Body.String())
	}
	var body struct {
		SessionID  string                 `json:"session_id"`
		Annotation trace.AnnotationResult `json:"annotation"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.SessionID != "session-1" || body.Annotation.SchemaVersion != trace.AnalysisSchemaVersion || body.Annotation.Tools == nil || body.Annotation.Skills == nil {
		t.Fatalf("response = %#v", body)
	}
}

func TestSessionEvaluationHandlerRejectsInvalidPayloadAndAuthentication(t *testing.T) {
	writer := &analysisWriter{}
	invalid := authenticatedTraceRequest(http.MethodPost, "/sessions/session-1/evaluation")
	invalid.Body = httptest.NewRequest(http.MethodPost, invalid.URL.Path, strings.NewReader(`{"schema_version":"1"}`)).Body
	response := httptest.NewRecorder()
	NewSessionEvaluationHandler(writer).ServeHTTP(response, invalid)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"invalid_analysis"`) {
		t.Fatalf("invalid status = %d, body = %s", response.Code, response.Body.String())
	}

	unauthenticated := httptest.NewRequest(http.MethodPost, "/sessions/session-1/evaluation", strings.NewReader(validEvaluationJSON()))
	response = httptest.NewRecorder()
	NewSessionEvaluationHandler(writer).ServeHTTP(response, unauthenticated)
	if response.Code != http.StatusUnauthorized || writer.evaluationCalls != 0 {
		t.Fatalf("unauthenticated status = %d, calls = %d", response.Code, writer.evaluationCalls)
	}
}

func TestSessionEvaluationHandlerPersistsResultAndMapsWriterFailure(t *testing.T) {
	writer := &analysisWriter{}
	request := authenticatedTraceRequest(http.MethodPost, "/sessions/session-1/evaluation")
	request.Body = httptest.NewRequest(http.MethodPost, request.URL.Path, strings.NewReader(validEvaluationJSON())).Body
	response := httptest.NewRecorder()
	NewSessionEvaluationHandler(writer).ServeHTTP(response, request)
	if response.Code != http.StatusOK || writer.evaluationCalls != 1 {
		t.Fatalf("status = %d, calls = %d, body = %s", response.Code, writer.evaluationCalls, response.Body.String())
	}

	writer.err = errors.New("database unavailable")
	request = authenticatedTraceRequest(http.MethodPost, "/sessions/session-1/evaluation")
	request.Body = httptest.NewRequest(http.MethodPost, request.URL.Path, strings.NewReader(validEvaluationJSON())).Body
	response = httptest.NewRecorder()
	NewSessionEvaluationHandler(writer).ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), `"code":"analysis_failed"`) {
		t.Fatalf("failure status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestSessionTraceHandlerIncludesStoredAnalysis(t *testing.T) {
	reader := &analysisReader{analysis: trace.Analysis{
		Annotation: &trace.AnnotationResult{SchemaVersion: trace.AnalysisSchemaVersion, Source: "session-annotator", Turns: []trace.TurnAnnotation{}},
		Evaluation: &trace.EvaluationResult{SchemaVersion: trace.AnalysisSchemaVersion, Source: "session-evaluator", Verdict: trace.EvaluationPass, JudgeAlignment: trace.JudgeAlignment{Status: trace.AlignmentNotRecorded}, EvaluationLedger: trace.EvaluationLedger{Project: "nala-trace", Improvements: []trace.Improvement{}}},
	}}
	handler := NewSessionTraceHandler(&traceEventRepository{events: []storage.HookEvent{testHookEvent("event-1", "UserPromptSubmit", "turn-1", "", time.Now().UTC(), map[string]any{"prompt": "review"})}}, reader)
	request := authenticatedTraceRequest(http.MethodGet, "/sessions/session-1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var result trace.Trace
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode trace: %v", err)
	}
	if result.Analysis.Annotation == nil || result.Analysis.Evaluation == nil {
		t.Fatalf("analysis = %#v", result.Analysis)
	}
}

func TestAnalysisRoutesRemainDistinctFromSessionDetail(t *testing.T) {
	router := NewHandler(
		Route{Pattern: "/sessions/:id/annotations", Handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.WriteHeader(http.StatusCreated)
		})},
		Route{Pattern: "/sessions/:id/evaluation", Handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.WriteHeader(http.StatusAccepted)
		})},
		Route{Pattern: "/sessions/:id", Handler: http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.WriteHeader(http.StatusOK)
		})},
	)

	for _, test := range []struct {
		path       string
		wantStatus int
	}{
		{path: "/sessions/session-1/annotations", wantStatus: http.StatusCreated},
		{path: "/sessions/session-1/evaluation", wantStatus: http.StatusAccepted},
		{path: "/sessions/session-1", wantStatus: http.StatusOK},
	} {
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
		})
	}
}

type analysisReader struct {
	analysis trace.Analysis
	err      error
}

func (reader *analysisReader) GetSessionAnalysisForUser(context.Context, string, string) (trace.Analysis, error) {
	return reader.analysis, reader.err
}
