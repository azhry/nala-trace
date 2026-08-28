package storage

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/azhry/nala-trace/backend/internal/trace"
)

func validAnnotation() trace.AnnotationResult {
	return trace.AnnotationResult{
		SchemaVersion: trace.AnalysisSchemaVersion,
		Source:        "session-annotator",
		Turns: []trace.TurnAnnotation{{
			EventID:             "event-1",
			FollowsInstructions: trace.AnnotationYes,
			Performance:         trace.PerformanceNeutral,
			Rationale:           "The turn followed the visible task constraints.",
		}},
	}
}

func validEvaluation() trace.EvaluationResult {
	return trace.EvaluationResult{
		SchemaVersion: trace.AnalysisSchemaVersion,
		Source:        "session-evaluator",
		Verdict:       trace.EvaluationPass,
		Critique:      "The trace satisfies the visible requirements.",
		EvaluationLedger: trace.EvaluationLedger{
			Project: "nala-trace",
		},
	}
}

func TestSessionAnalysisRepositorySaveAnnotationsNormalizesAndScopes(t *testing.T) {
	var gotUserID, gotSessionID string
	var gotAnnotation trace.AnnotationResult
	updatedAt := time.Date(2026, 8, 28, 0, 0, 0, 0, time.UTC)
	repository := &SessionAnalysisRepository{
		upsertAnnotation: func(_ context.Context, userID, sessionID string, annotation trace.AnnotationResult) (trace.Analysis, error) {
			gotUserID, gotSessionID, gotAnnotation = userID, sessionID, annotation
			return trace.Analysis{Annotation: &annotation, UpdatedAt: &updatedAt}, nil
		},
	}

	result, err := repository.SaveAnnotations(context.Background(), "user-1", "session-1", validAnnotation())
	if err != nil {
		t.Fatalf("SaveAnnotations() error = %v", err)
	}
	if gotUserID != "user-1" || gotSessionID != "session-1" || gotAnnotation.Tools == nil || gotAnnotation.Skills == nil {
		t.Fatalf("upsert input = scope (%q, %q), annotation %#v", gotUserID, gotSessionID, gotAnnotation)
	}
	if result.Annotation == nil || result.UpdatedAt == nil {
		t.Fatalf("result = %#v, want annotation and timestamp", result)
	}
}

func TestSessionAnalysisRepositorySaveEvaluationMapsStorageFailure(t *testing.T) {
	repository := &SessionAnalysisRepository{
		upsertEvaluation: func(context.Context, string, string, trace.EvaluationResult) (trace.Analysis, error) {
			return trace.Analysis{}, errors.New("database unavailable")
		},
	}

	_, err := repository.SaveEvaluation(context.Background(), "user-1", "session-1", validEvaluation())
	var repositoryErr *RepositoryError
	if !errors.As(err, &repositoryErr) || repositoryErr.Operation != "upsert_session_evaluation" {
		t.Fatalf("error = %v, want upsert_session_evaluation RepositoryError", err)
	}
}

func TestSessionAnalysisRepositoryRejectsMissingScopeBeforeStorage(t *testing.T) {
	repository := &SessionAnalysisRepository{
		upsertAnnotation: func(context.Context, string, string, trace.AnnotationResult) (trace.Analysis, error) {
			t.Fatal("upsert should not run for invalid scope")
			return trace.Analysis{}, nil
		},
	}

	if _, err := repository.SaveAnnotations(context.Background(), "", "session-1", validAnnotation()); err == nil {
		t.Fatal("expected missing user scope error")
	}
}

func TestSessionAnalysisRepositoryGetScopesOwnerAndSession(t *testing.T) {
	var gotUserID, gotSessionID string
	repository := &SessionAnalysisRepository{
		find: func(_ context.Context, userID, sessionID string) (trace.Analysis, error) {
			gotUserID, gotSessionID = userID, sessionID
			return trace.Analysis{}, nil
		},
	}

	if _, err := repository.GetSessionAnalysisForUser(context.Background(), "user-1", "session-1"); err != nil {
		t.Fatalf("GetSessionAnalysisForUser() error = %v", err)
	}
	if gotUserID != "user-1" || gotSessionID != "session-1" {
		t.Fatalf("scope = (%q, %q), want (user-1, session-1)", gotUserID, gotSessionID)
	}
}
