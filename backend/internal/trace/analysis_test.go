package trace

import (
	"strings"
	"testing"
)

func TestAnnotationNormalizeInitializesCollections(t *testing.T) {
	result := AnnotationResult{SchemaVersion: AnalysisSchemaVersion, Source: "session-annotator", Coverage: emptyAnnotationCoverage()}
	result.Normalize()

	if result.UserTurns == nil || result.Turns == nil || result.Tools == nil || result.Skills == nil || result.Files == nil {
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
			ResponseSummary:     "The assistant answered the request.",
			ScopeAdherence:      ScopeWithin,
			Groundedness:        GroundedSupported,
			Verification:        VerificationVerified,
		}},
		Coverage: emptyAnnotationCoverage(),
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

func TestAnalysisV2RequiresExactCoverageAndSignalOccurrences(t *testing.T) {
	annotation := AnnotationResult{
		SchemaVersion: AnalysisSchemaVersion,
		Source:        "session-annotator",
		Turns: []TurnAnnotation{{
			EventID:             "turn-1",
			FollowsInstructions: AnnotationYes,
			Performance:         PerformanceNeutral,
			Rationale:           "The response answered the bounded request.",
			ResponseSummary:     "The assistant returned a status update.",
			ScopeAdherence:      ScopeWithin,
			Groundedness:        GroundedSupported,
			Verification:        VerificationNotApplicable,
		}},
		Coverage: emptyAnnotationCoverage(),
	}
	if err := annotation.Validate(); err == nil || !strings.Contains(err.Error(), "coverage.agent_turns") {
		t.Fatalf("Validate() error = %v, want exact agent-turn coverage", err)
	}

	evaluation := EvaluationResult{
		SchemaVersion:    AnalysisSchemaVersion,
		Source:           "session-evaluator",
		Verdict:          EvaluationFail,
		Critique:         "The captured evidence shows an unsupported claim.",
		ReviewSignals:    []ReviewSignal{{Name: "unsupported_claim", Count: 1, Severity: "warning", Occurrences: []ReviewSignalOccurrence{}}},
		EvaluationLedger: EvaluationLedger{Project: "nala-trace", Improvements: []Improvement{}},
	}
	if err := evaluation.Validate(); err == nil || !strings.Contains(err.Error(), "count must match") {
		t.Fatalf("Validate() error = %v, want count-to-occurrence mismatch", err)
	}
}

func TestEvaluationV2ImprovementsMustTargetAgentInstructions(t *testing.T) {
	result := EvaluationResult{
		SchemaVersion: AnalysisSchemaVersion,
		Source:        "session-evaluator",
		Verdict:       EvaluationFail,
		Critique:      "The agent skipped a required verification step.",
		EvaluationLedger: EvaluationLedger{
			Project: "nala-trace",
			Improvements: []Improvement{{
				TargetType:       ImprovementWorkflowInstructions,
				Path:             "backend/internal/server/sessions.go",
				Change:           "Add a retry branch.",
				Reason:           "The endpoint returned a temporary error.",
				EvidenceEventIDs: []string{"event-1"},
			}},
		},
	}
	if err := result.Validate(); err == nil || !strings.Contains(err.Error(), "agent instruction markdown") {
		t.Fatalf("Validate() error = %v, want project-code target rejection", err)
	}
}

func TestAnnotationV2ValidatesForensicEvidenceCategories(t *testing.T) {
	result := AnnotationResult{
		SchemaVersion: AnalysisSchemaVersion,
		Source:        "session-annotator",
		UserTurns: []UserTurnAnnotation{{
			EventID:    "user-1",
			SignalType: UserSignalConstraint,
			Summary:    "The user restricted the change to agent instructions.",
			Rationale:  "The message explicitly names the allowed change boundary.",
		}},
		Turns: []TurnAnnotation{{
			EventID:             "assistant-1",
			FollowsInstructions: AnnotationYes,
			Performance:         PerformanceImproved,
			Rationale:           "The assistant follows the user's stated boundary.",
			ResponseSummary:     "The assistant updates only the workflow instructions.",
			ScopeAdherence:      ScopeWithin,
			Groundedness:        GroundedSupported,
			Verification:        VerificationVerified,
			RelatedEventIDs:     []string{"user-1", "tool-1"},
		}},
		Tools: []ToolAnnotation{{
			EventID:          "tool-1",
			ToolUseID:        stringPointer("use-1"),
			ToolName:         "Bash",
			InputSummary:     "Ran focused backend tests.",
			OutputSummary:    "Tests exited successfully.",
			CompletionStatus: ToolCompleted,
			Necessary:        AnnotationYes,
			Rationale:        "This verified the backend contract change.",
		}, {
			EventID:          "tool-2",
			ToolName:         "Bash",
			InputSummary:     "A second shell invocation was started.",
			OutputSummary:    "No completion hook was captured, so its result is unknown.",
			CompletionStatus: ToolUnknown,
			Necessary:        AnnotationUnclear,
			Rationale:        "The incomplete hook pair does not show what the invocation accomplished.",
		}},
		Skills: []SkillAnnotation{{
			EventID:   "skill-1",
			SkillName: "manual-test-verification",
			Summary:   "The skill defined how to report independent test outcomes.",
			Necessary: AnnotationYes,
			Rationale: "The task requires trustworthy verification evidence.",
		}},
		Files: []FileAnnotation{{
			EventID:   "file-1",
			Path:      ".agents/workflows/backend.md",
			Operation: "read",
			Summary:   "Read the backend testing and handoff constraints.",
			Necessary: AnnotationYes,
			Rationale: "This instruction file governs the backend change.",
		}},
		CaptureGaps: []CaptureGap{{
			Category: "tool_completion",
			EventIDs: []string{"tool-2"},
			Summary:  "The second tool invocation has no captured completion hook.",
			Impact:   "Its command result cannot be verified.",
		}},
		Coverage: &AnnotationCoverage{
			UserTurns:        &CoverageCategory{Captured: 1, Labeled: 1},
			AgentTurns:       &CoverageCategory{Captured: 1, Labeled: 1},
			ToolCalls:        &CoverageCategory{Captured: 2, Labeled: 2, Unclear: 1},
			SkillInvocations: &CoverageCategory{Captured: 1, Labeled: 1},
			FileOperations:   &CoverageCategory{Captured: 1, Labeled: 1},
		},
	}
	if err := result.Validate(); err != nil {
		t.Fatalf("forensic annotation validation error = %v", err)
	}
}

func TestEvaluationV2RejectsDuplicateOccurrenceEventIDs(t *testing.T) {
	result := EvaluationResult{
		SchemaVersion: AnalysisSchemaVersion,
		Source:        "session-evaluator",
		Verdict:       EvaluationFail,
		Critique:      "Two distinct findings are backed by separate captured events.",
		ReviewSignals: []ReviewSignal{{
			Name:     "unsupported_claim",
			Count:    2,
			Severity: "warning",
			Occurrences: []ReviewSignalOccurrence{
				{EventID: "event-1", Summary: "First unsupported claim.", Impact: "Misleads the user."},
				{EventID: "event-1", Summary: "Second unsupported claim.", Impact: "Misleads the user again."},
			},
		}},
		EvaluationLedger: EvaluationLedger{Project: "nala-trace", Improvements: []Improvement{}},
	}
	if err := result.Validate(); err == nil || !strings.Contains(err.Error(), "duplicate occurrence event ID") {
		t.Fatalf("Validate() error = %v, want duplicate occurrence rejection", err)
	}
}

func TestLegacyAnalysisSchemaV1RemainsReadableAndWritable(t *testing.T) {
	annotation := AnnotationResult{
		SchemaVersion: LegacyAnalysisSchemaVersion,
		Source:        "legacy-annotator",
		Skills:        []SkillAnnotation{{EventID: "legacy-skill-event", Necessary: AnnotationUnclear, Rationale: "The older payload did not record a skill name."}},
	}
	annotation.Normalize()
	if err := annotation.Validate(); err != nil {
		t.Fatalf("legacy annotation validation error = %v", err)
	}
	evaluation := EvaluationResult{
		SchemaVersion: LegacyAnalysisSchemaVersion,
		Source:        "legacy-evaluator",
		Verdict:       EvaluationPass,
		Critique:      "The legacy result is preserved.",
		EvaluationLedger: EvaluationLedger{
			Project:      "nala-trace",
			Improvements: []Improvement{{Path: "backend/internal/server/sessions.go", Change: "Old path is retained.", Reason: "Legacy payload compatibility."}},
		},
	}
	evaluation.Normalize()
	if err := evaluation.Validate(); err != nil {
		t.Fatalf("legacy evaluation validation error = %v", err)
	}
}

func emptyAnnotationCoverage() *AnnotationCoverage {
	zero := func() *CoverageCategory { return &CoverageCategory{} }
	return &AnnotationCoverage{UserTurns: zero(), AgentTurns: zero(), ToolCalls: zero(), SkillInvocations: zero(), FileOperations: zero()}
}

func stringPointer(value string) *string {
	return &value
}
