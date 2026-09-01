package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/azhry/nala-trace/backend/internal/auth"
	"github.com/azhry/nala-trace/backend/internal/storage"
	"github.com/azhry/nala-trace/backend/internal/trace"
)

const maxAnalysisBodyBytes int64 = 2 << 20

func NewSessionAnnotationHandler(repository storage.SessionAnalysisWriter) http.Handler {
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
		sessionID := sessionIDForAnalysisPath(request.URL.Path, "/annotations")
		if sessionID == "" {
			WriteError(response, http.StatusNotFound, "analysis_not_found", "session analysis was not found")
			return
		}
		var annotation trace.AnnotationResult
		if err := decodeAnalysisBody(request, &annotation); err != nil {
			WriteError(response, http.StatusBadRequest, "invalid_analysis", "annotation payload is invalid")
			return
		}
		annotation.Normalize()
		if err := annotation.Validate(); err != nil {
			WriteError(response, http.StatusBadRequest, "invalid_analysis", "annotation payload is invalid")
			return
		}
		if repository == nil {
			WriteError(response, http.StatusServiceUnavailable, "analysis_unavailable", "session analysis is unavailable")
			return
		}
		analysis, err := repository.SaveAnnotations(request.Context(), user.ID, sessionID, annotation)
		if err != nil {
			writeAnalysisRepositoryError(response, err, "annotation could not be stored")
			return
		}
		WriteJSON(response, http.StatusOK, map[string]any{
			"session_id": sessionID,
			"annotation": analysis.Annotation,
			"updated_at": analysis.UpdatedAt,
		})
	})
}

func NewSessionEvaluationHandler(repository storage.SessionAnalysisWriter) http.Handler {
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
		sessionID := sessionIDForAnalysisPath(request.URL.Path, "/evaluation")
		if sessionID == "" {
			WriteError(response, http.StatusNotFound, "analysis_not_found", "session analysis was not found")
			return
		}
		var evaluation trace.EvaluationResult
		if err := decodeAnalysisBody(request, &evaluation); err != nil {
			WriteError(response, http.StatusBadRequest, "invalid_analysis", "evaluation payload is invalid")
			return
		}
		evaluation.Normalize()
		if err := evaluation.Validate(); err != nil {
			WriteError(response, http.StatusBadRequest, "invalid_analysis", "evaluation payload is invalid")
			return
		}
		if repository == nil {
			WriteError(response, http.StatusServiceUnavailable, "analysis_unavailable", "session analysis is unavailable")
			return
		}
		analysis, err := repository.SaveEvaluation(request.Context(), user.ID, sessionID, evaluation)
		if err != nil {
			writeAnalysisRepositoryError(response, err, "evaluation could not be stored")
			return
		}
		WriteJSON(response, http.StatusOK, map[string]any{
			"session_id": sessionID,
			"evaluation": analysis.Evaluation,
			"updated_at": analysis.UpdatedAt,
		})
	})
}

func decodeAnalysisBody(request *http.Request, target any) error {
	if request.Body == nil {
		return io.EOF
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, maxAnalysisBodyBytes+1))
	if err != nil || int64(len(body)) > maxAnalysisBodyBytes || len(strings.TrimSpace(string(body))) == 0 {
		return io.ErrUnexpectedEOF
	}
	return json.Unmarshal(body, target)
}

func sessionIDForAnalysisPath(requestPath, suffix string) string {
	const prefix = "/sessions/"
	if !strings.HasPrefix(requestPath, prefix) || !strings.HasSuffix(requestPath, suffix) {
		return ""
	}
	id := strings.Trim(strings.TrimSuffix(strings.TrimPrefix(requestPath, prefix), suffix), "/")
	if id == "" || strings.Contains(id, "/") {
		return ""
	}
	return id
}

func writeAnalysisRepositoryError(response http.ResponseWriter, err error, message string) {
	_ = err
	WriteError(response, http.StatusInternalServerError, "analysis_failed", message)
}
