package trace

import (
	"strings"
	"testing"
)

func TestAnnotationNormalizeInitializesCollections(t *testing.T) {
	result := AnnotationResult{SchemaVersion: AnalysisSchemaVersion, Source: "session-annotator"}
	result.Normalize()

	if result.Turns == nil || result.Tools == nil || result.Skills == nil {
		t.Fatalf("normalized annotation has nil collections: %#v", result)
	}
	if err := result.Validate(); err != nil {
		t.Fatalf("normalized annotation is invalid: %v", err)
	}
}

func TestAnnotationValidateRejectsUnsupportedEvidenceLabels(t *testing.T) {
	result := AnnotationResult{
		SchemaVersion: AnalysisSchemaVersion,
		Source:        "session-annotator",
		Turns: []TurnAnnotation{{
			EventID:             "event-1",
			FollowsInstructions: AnnotationVerdict("maybe"),
			Performance:         PerformanceNeutral,
			Rationale:           "The trace contains the applicable instruction.",
		}},
	}

	if err := result.Validate(); err == nil || !strings.Contains(err.Error(), "follows_instructions") {
		t.Fatalf("Validate() error = %v, want unsupported instruction label", err)
	}
}

func TestEvaluationNormalizeAndValidateAllowsUnknownWithoutCritique(t *testing.T) {
	result := EvaluationResult{
		SchemaVersion: AnalysisSchemaVersion,
		Source:        "session-evaluator",
		Verdict:       EvaluationUnknown,
		EvaluationLedger: EvaluationLedger{
			Project: "nala-trace",
		},
	}
	result.Normalize()

	if result.JudgeAlignment.Status != AlignmentNotRecorded || result.ReviewSignals == nil || result.EvaluationLedger.Improvements == nil {
		t.Fatalf("normalized evaluation = %#v", result)
	}
	if err := result.Validate(); err != nil {
		t.Fatalf("unknown evaluation is invalid: %v", err)
	}
}

func TestEvaluationValidateRequiresLedgerProject(t *testing.T) {
	result := EvaluationResult{
		SchemaVersion: AnalysisSchemaVersion,
		Source:        "session-evaluator",
		Verdict:       EvaluationPass,
		Critique:      "The trace meets the applicable requirements.",
	}

	if err := result.Validate(); err == nil || !strings.Contains(err.Error(), "evaluation_ledger.project") {
		t.Fatalf("Validate() error = %v, want missing ledger project", err)
	}
}
