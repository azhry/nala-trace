package trace

import (
	"fmt"
	"path"
	"strings"
	"time"
)

const AnalysisSchemaVersion = "2"
const LegacyAnalysisSchemaVersion = "1"

type AnnotationVerdict string

const (
	AnnotationYes     AnnotationVerdict = "yes"
	AnnotationNo      AnnotationVerdict = "no"
	AnnotationUnclear AnnotationVerdict = "unclear"
)

type PerformanceVerdict string

const (
	PerformanceImproved PerformanceVerdict = "improved"
	PerformanceNeutral  PerformanceVerdict = "neutral"
	PerformanceWorsened PerformanceVerdict = "worsened"
	PerformanceUnclear  PerformanceVerdict = "unclear"
)

type UserSignalType string

const (
	UserSignalRequest       UserSignalType = "request"
	UserSignalConstraint    UserSignalType = "constraint"
	UserSignalClarification UserSignalType = "clarification"
	UserSignalCorrection    UserSignalType = "correction"
	UserSignalApproval      UserSignalType = "approval"
	UserSignalRejection     UserSignalType = "rejection"
	UserSignalFeedback      UserSignalType = "feedback"
	UserSignalOther         UserSignalType = "other"
	UserSignalUnclear       UserSignalType = "unclear"
)

type ScopeAdherence string

const (
	ScopeWithin    ScopeAdherence = "within_scope"
	ScopeDeviation ScopeAdherence = "deviation"
	ScopeUnclear   ScopeAdherence = "unclear"
)

type Groundedness string

const (
	GroundedSupported   Groundedness = "supported"
	GroundedUnsupported Groundedness = "unsupported"
	GroundedUnclear     Groundedness = "unclear"
)

type VerificationStatus string

const (
	VerificationVerified      VerificationStatus = "verified"
	VerificationNotVerified   VerificationStatus = "not_verified"
	VerificationNotApplicable VerificationStatus = "not_applicable"
	VerificationUnclear       VerificationStatus = "unclear"
)

type ToolCompletionStatus string

const (
	ToolCompleted  ToolCompletionStatus = "completed"
	ToolIncomplete ToolCompletionStatus = "incomplete"
	ToolFailed     ToolCompletionStatus = "failed"
	ToolUnknown    ToolCompletionStatus = "unknown"
)

type ImprovementTarget string

const (
	ImprovementAgentBehavior        ImprovementTarget = "agent_behavior"
	ImprovementAgentInstructions    ImprovementTarget = "agent_instructions"
	ImprovementSkillInstructions    ImprovementTarget = "skill_instructions"
	ImprovementWorkflowInstructions ImprovementTarget = "workflow_instructions"
)

type CoverageCategory struct {
	Captured int `bson:"captured" json:"captured"`
	Labeled  int `bson:"labeled" json:"labeled"`
	Unclear  int `bson:"unclear" json:"unclear"`
}

type AnnotationCoverage struct {
	UserTurns        *CoverageCategory `bson:"user_turns,omitempty" json:"user_turns,omitempty"`
	AgentTurns       *CoverageCategory `bson:"agent_turns,omitempty" json:"agent_turns,omitempty"`
	ToolCalls        *CoverageCategory `bson:"tool_calls,omitempty" json:"tool_calls,omitempty"`
	SkillInvocations *CoverageCategory `bson:"skill_invocations,omitempty" json:"skill_invocations,omitempty"`
	FileOperations   *CoverageCategory `bson:"file_operations,omitempty" json:"file_operations,omitempty"`
}

type AnnotationResult struct {
	SchemaVersion string               `bson:"schema_version" json:"schema_version"`
	Source        string               `bson:"source" json:"source"`
	UserTurns     []UserTurnAnnotation `bson:"user_turns,omitempty" json:"user_turns,omitempty"`
	Turns         []TurnAnnotation     `bson:"turns" json:"turns"`
	Tools         []ToolAnnotation     `bson:"tools" json:"tools"`
	Skills        []SkillAnnotation    `bson:"skills" json:"skills"`
	Files         []FileAnnotation     `bson:"files,omitempty" json:"files,omitempty"`
	CaptureGaps   []CaptureGap         `bson:"capture_gaps,omitempty" json:"capture_gaps,omitempty"`
	Coverage      *AnnotationCoverage  `bson:"coverage,omitempty" json:"coverage,omitempty"`
}

type UserTurnAnnotation struct {
	EventID        string         `bson:"event_id" json:"event_id"`
	TurnID         *string        `bson:"turn_id,omitempty" json:"turn_id,omitempty"`
	SignalType     UserSignalType `bson:"signal_type" json:"signal_type"`
	Summary        string         `bson:"summary" json:"summary"`
	Rationale      string         `bson:"rationale" json:"rationale"`
	LinkedEventIDs []string       `bson:"linked_event_ids,omitempty" json:"linked_event_ids,omitempty"`
}

type TurnAnnotation struct {
	EventID             string             `bson:"event_id" json:"event_id"`
	TurnID              *string            `bson:"turn_id" json:"turn_id"`
	FollowsInstructions AnnotationVerdict  `bson:"follows_instructions" json:"follows_instructions"`
	Performance         PerformanceVerdict `bson:"performance" json:"performance"`
	Rationale           string             `bson:"rationale" json:"rationale"`
	ResponseSummary     string             `bson:"response_summary,omitempty" json:"response_summary,omitempty"`
	ScopeAdherence      ScopeAdherence     `bson:"scope_adherence,omitempty" json:"scope_adherence,omitempty"`
	Groundedness        Groundedness       `bson:"groundedness,omitempty" json:"groundedness,omitempty"`
	Verification        VerificationStatus `bson:"verification,omitempty" json:"verification,omitempty"`
	RelatedEventIDs     []string           `bson:"related_event_ids,omitempty" json:"related_event_ids,omitempty"`
}

type ToolAnnotation struct {
	EventID          string               `bson:"event_id" json:"event_id"`
	ToolUseID        *string              `bson:"tool_use_id" json:"tool_use_id"`
	ToolName         string               `bson:"tool_name,omitempty" json:"tool_name,omitempty"`
	InputSummary     string               `bson:"input_summary,omitempty" json:"input_summary,omitempty"`
	OutputSummary    string               `bson:"output_summary,omitempty" json:"output_summary,omitempty"`
	CompletionStatus ToolCompletionStatus `bson:"completion_status,omitempty" json:"completion_status,omitempty"`
	Necessary        AnnotationVerdict    `bson:"necessary" json:"necessary"`
	Rationale        string               `bson:"rationale" json:"rationale"`
}

type SkillAnnotation struct {
	EventID   string            `bson:"event_id" json:"event_id"`
	SkillName string            `bson:"skill_name" json:"skill_name"`
	Summary   string            `bson:"summary,omitempty" json:"summary,omitempty"`
	Necessary AnnotationVerdict `bson:"necessary" json:"necessary"`
	Rationale string            `bson:"rationale" json:"rationale"`
}

type FileAnnotation struct {
	EventID   string            `bson:"event_id" json:"event_id"`
	Path      string            `bson:"path" json:"path"`
	Operation string            `bson:"operation" json:"operation"`
	Summary   string            `bson:"summary" json:"summary"`
	Necessary AnnotationVerdict `bson:"necessary" json:"necessary"`
	Rationale string            `bson:"rationale" json:"rationale"`
}

type CaptureGap struct {
	Category string   `bson:"category" json:"category"`
	EventIDs []string `bson:"event_ids" json:"event_ids"`
	Summary  string   `bson:"summary" json:"summary"`
	Impact   string   `bson:"impact" json:"impact"`
}

type EvaluationVerdict string

const (
	EvaluationPass    EvaluationVerdict = "pass"
	EvaluationFail    EvaluationVerdict = "fail"
	EvaluationUnknown EvaluationVerdict = "unknown"
)

type AlignmentStatus string

const (
	AlignmentAligned     AlignmentStatus = "aligned"
	AlignmentNotAligned  AlignmentStatus = "not_aligned"
	AlignmentNotRecorded AlignmentStatus = "not_recorded"
)

type EvaluationResult struct {
	SchemaVersion    string            `bson:"schema_version" json:"schema_version"`
	Source           string            `bson:"source" json:"source"`
	Verdict          EvaluationVerdict `bson:"verdict" json:"verdict"`
	Critique         string            `bson:"critique" json:"critique"`
	ReviewSignals    []ReviewSignal    `bson:"review_signals" json:"review_signals"`
	JudgeAlignment   JudgeAlignment    `bson:"judge_alignment" json:"judge_alignment"`
	EvaluationLedger EvaluationLedger  `bson:"evaluation_ledger" json:"evaluation_ledger"`
}

type ReviewSignal struct {
	Name        string                   `bson:"name" json:"name"`
	Count       int                      `bson:"count" json:"count"`
	Severity    string                   `bson:"severity" json:"severity"`
	Detail      string                   `bson:"detail" json:"detail"`
	Occurrences []ReviewSignalOccurrence `bson:"occurrences,omitempty" json:"occurrences,omitempty"`
}

type ReviewSignalOccurrence struct {
	EventID    string     `bson:"event_id" json:"event_id"`
	EventKind  string     `bson:"event_kind,omitempty" json:"event_kind,omitempty"`
	OccurredAt *time.Time `bson:"occurred_at,omitempty" json:"occurred_at,omitempty"`
	Summary    string     `bson:"summary" json:"summary"`
	Impact     string     `bson:"impact" json:"impact"`
}

type JudgeAlignment struct {
	Status         AlignmentStatus `bson:"status" json:"status"`
	HumanLabel     string          `bson:"human_label,omitempty" json:"human_label,omitempty"`
	EvaluatorLabel string          `bson:"evaluator_label,omitempty" json:"evaluator_label,omitempty"`
	Agreement      *bool           `bson:"agreement,omitempty" json:"agreement,omitempty"`
	Dataset        string          `bson:"dataset,omitempty" json:"dataset,omitempty"`
}

type EvaluationLedger struct {
	Project      string        `bson:"project" json:"project"`
	Improvements []Improvement `bson:"improvements" json:"improvements"`
}

type Improvement struct {
	TargetType       ImprovementTarget `bson:"target_type,omitempty" json:"target_type,omitempty"`
	Path             string            `bson:"path" json:"path"`
	Change           string            `bson:"change" json:"change"`
	Reason           string            `bson:"reason" json:"reason"`
	EvidenceEventIDs []string          `bson:"evidence_event_ids,omitempty" json:"evidence_event_ids,omitempty"`
}

type Analysis struct {
	Annotation *AnnotationResult `bson:"annotation,omitempty" json:"annotation"`
	Evaluation *EvaluationResult `bson:"evaluation,omitempty" json:"evaluation"`
	UpdatedAt  *time.Time        `bson:"updated_at,omitempty" json:"updated_at,omitempty"`
}

func NewAnalysis() Analysis {
	return Analysis{}
}

type AnalysisValidationError struct {
	Field string
	Code  string
}

func (e *AnalysisValidationError) Error() string {
	return fmt.Sprintf("invalid analysis %s: %s", e.Field, e.Code)
}

func (result *AnnotationResult) Normalize() {
	if result.UserTurns == nil {
		result.UserTurns = make([]UserTurnAnnotation, 0)
	}
	if result.Turns == nil {
		result.Turns = make([]TurnAnnotation, 0)
	}
	if result.Tools == nil {
		result.Tools = make([]ToolAnnotation, 0)
	}
	if result.Skills == nil {
		result.Skills = make([]SkillAnnotation, 0)
	}
	if result.Files == nil {
		result.Files = make([]FileAnnotation, 0)
	}
	if result.CaptureGaps == nil {
		result.CaptureGaps = make([]CaptureGap, 0)
	}
}

func (result AnnotationResult) Validate() error {
	if !validAnalysisSchemaVersion(result.SchemaVersion) {
		return &AnalysisValidationError{Field: "schema_version", Code: "unsupported value"}
	}
	v2 := result.SchemaVersion == AnalysisSchemaVersion
	if err := validateSource(result.Source); err != nil {
		return err
	}
	if len(result.UserTurns) > maxAnalysisRecords || len(result.Turns) > maxAnalysisRecords || len(result.Tools) > maxAnalysisRecords || len(result.Skills) > maxAnalysisRecords || len(result.Files) > maxAnalysisRecords || len(result.CaptureGaps) > maxAnalysisRecords {
		return &AnalysisValidationError{Field: "records", Code: "too many records"}
	}
	for index, annotation := range result.UserTurns {
		field := fmt.Sprintf("user_turns[%d]", index)
		if err := validateEventID(annotation.EventID, field+".event_id"); err != nil {
			return err
		}
		if v2 {
			if err := validateOptionalEventID(annotation.TurnID, field+".turn_id"); err != nil {
				return err
			}
		}
		if !validUserSignalType(annotation.SignalType) {
			return &AnalysisValidationError{Field: field + ".signal_type", Code: "unsupported value"}
		}
		if err := validateRationale(annotation.Summary, field+".summary", false); err != nil {
			return err
		}
		if err := validateRationale(annotation.Rationale, field+".rationale", false); err != nil {
			return err
		}
		if err := validateEventIDList(annotation.LinkedEventIDs, field+".linked_event_ids"); err != nil {
			return err
		}
	}
	for index, annotation := range result.Turns {
		field := fmt.Sprintf("turns[%d]", index)
		if err := validateEventID(annotation.EventID, fmt.Sprintf("turns[%d].event_id", index)); err != nil {
			return err
		}
		if v2 {
			if err := validateOptionalEventID(annotation.TurnID, field+".turn_id"); err != nil {
				return err
			}
		}
		if !validAnnotationVerdict(annotation.FollowsInstructions) {
			return &AnalysisValidationError{Field: fmt.Sprintf("turns[%d].follows_instructions", index), Code: "unsupported value"}
		}
		if !validPerformanceVerdict(annotation.Performance) {
			return &AnalysisValidationError{Field: fmt.Sprintf("turns[%d].performance", index), Code: "unsupported value"}
		}
		if err := validateRationale(annotation.Rationale, fmt.Sprintf("turns[%d].rationale", index), false); err != nil {
			return err
		}
		if annotation.ScopeAdherence != "" && !validScopeAdherence(annotation.ScopeAdherence) {
			return &AnalysisValidationError{Field: field + ".scope_adherence", Code: "unsupported value"}
		}
		if annotation.Groundedness != "" && !validGroundedness(annotation.Groundedness) {
			return &AnalysisValidationError{Field: field + ".groundedness", Code: "unsupported value"}
		}
		if annotation.Verification != "" && !validVerificationStatus(annotation.Verification) {
			return &AnalysisValidationError{Field: field + ".verification", Code: "unsupported value"}
		}
		if err := validateRationale(annotation.ResponseSummary, field+".response_summary", !v2); err != nil {
			return err
		}
		if v2 && (annotation.ScopeAdherence == "" || annotation.Groundedness == "" || annotation.Verification == "") {
			return &AnalysisValidationError{Field: field, Code: "schema version 2 requires scope, groundedness, and verification labels"}
		}
		if err := validateEventIDList(annotation.RelatedEventIDs, field+".related_event_ids"); err != nil {
			return err
		}
	}
	for index, annotation := range result.Tools {
		field := fmt.Sprintf("tools[%d]", index)
		if err := validateEventID(annotation.EventID, fmt.Sprintf("tools[%d].event_id", index)); err != nil {
			return err
		}
		if v2 {
			if err := validateOptionalEventID(annotation.ToolUseID, field+".tool_use_id"); err != nil {
				return err
			}
		}
		if !validAnnotationVerdict(annotation.Necessary) {
			return &AnalysisValidationError{Field: fmt.Sprintf("tools[%d].necessary", index), Code: "unsupported value"}
		}
		if err := validateRationale(annotation.Rationale, fmt.Sprintf("tools[%d].rationale", index), false); err != nil {
			return err
		}
		if v2 {
			if err := validateShortString(annotation.ToolName, field+".tool_name", true); err != nil {
				return err
			}
			if err := validateRationale(annotation.InputSummary, field+".input_summary", false); err != nil {
				return err
			}
			if err := validateRationale(annotation.OutputSummary, field+".output_summary", false); err != nil {
				return err
			}
			if !validToolCompletionStatus(annotation.CompletionStatus) {
				return &AnalysisValidationError{Field: field + ".completion_status", Code: "unsupported value"}
			}
		}
	}
	for index, annotation := range result.Skills {
		field := fmt.Sprintf("skills[%d]", index)
		if err := validateEventID(annotation.EventID, fmt.Sprintf("skills[%d].event_id", index)); err != nil {
			return err
		}
		if err := validateShortString(annotation.SkillName, field+".skill_name", v2); err != nil {
			return err
		}
		if !validAnnotationVerdict(annotation.Necessary) {
			return &AnalysisValidationError{Field: fmt.Sprintf("skills[%d].necessary", index), Code: "unsupported value"}
		}
		if err := validateRationale(annotation.Rationale, fmt.Sprintf("skills[%d].rationale", index), false); err != nil {
			return err
		}
		if v2 {
			if err := validateRationale(annotation.Summary, field+".summary", false); err != nil {
				return err
			}
		}
	}
	for index, annotation := range result.Files {
		field := fmt.Sprintf("files[%d]", index)
		if err := validateEventID(annotation.EventID, field+".event_id"); err != nil {
			return err
		}
		if err := validateShortString(annotation.Path, field+".path", true); err != nil {
			return err
		}
		if err := validateShortString(annotation.Operation, field+".operation", true); err != nil {
			return err
		}
		if err := validateRationale(annotation.Summary, field+".summary", false); err != nil {
			return err
		}
		if !validAnnotationVerdict(annotation.Necessary) {
			return &AnalysisValidationError{Field: field + ".necessary", Code: "unsupported value"}
		}
		if err := validateRationale(annotation.Rationale, field+".rationale", false); err != nil {
			return err
		}
	}
	for index, gap := range result.CaptureGaps {
		field := fmt.Sprintf("capture_gaps[%d]", index)
		if err := validateShortString(gap.Category, field+".category", true); err != nil {
			return err
		}
		if len(gap.EventIDs) == 0 {
			return &AnalysisValidationError{Field: field + ".event_ids", Code: "at least one observed event is required"}
		}
		if err := validateEventIDList(gap.EventIDs, field+".event_ids"); err != nil {
			return err
		}
		if err := validateRationale(gap.Summary, field+".summary", false); err != nil {
			return err
		}
		if err := validateRationale(gap.Impact, field+".impact", false); err != nil {
			return err
		}
	}
	if v2 {
		if err := validateCoverage(result); err != nil {
			return err
		}
	}
	return nil
}

func (result EvaluationResult) Validate() error {
	if !validAnalysisSchemaVersion(result.SchemaVersion) {
		return &AnalysisValidationError{Field: "schema_version", Code: "unsupported value"}
	}
	v2 := result.SchemaVersion == AnalysisSchemaVersion
	if err := validateSource(result.Source); err != nil {
		return err
	}
	if !validEvaluationVerdict(result.Verdict) {
		return &AnalysisValidationError{Field: "verdict", Code: "unsupported value"}
	}
	if err := validateRationale(result.Critique, "critique", result.Verdict == EvaluationUnknown); err != nil {
		return err
	}
	if len(result.ReviewSignals) > maxAnalysisRecords {
		return &AnalysisValidationError{Field: "review_signals", Code: "too many records"}
	}
	for index, signal := range result.ReviewSignals {
		if err := validateShortString(signal.Name, fmt.Sprintf("review_signals[%d].name", index), true); err != nil {
			return err
		}
		if signal.Count < 0 {
			return &AnalysisValidationError{Field: fmt.Sprintf("review_signals[%d].count", index), Code: "must be non-negative"}
		}
		if signal.Severity != "info" && signal.Severity != "warning" && signal.Severity != "critical" && signal.Severity != "unknown" {
			return &AnalysisValidationError{Field: fmt.Sprintf("review_signals[%d].severity", index), Code: "unsupported value"}
		}
		if err := validateRationale(signal.Detail, fmt.Sprintf("review_signals[%d].detail", index), true); err != nil {
			return err
		}
		if len(signal.Occurrences) > maxAnalysisRecords {
			return &AnalysisValidationError{Field: fmt.Sprintf("review_signals[%d].occurrences", index), Code: "too many records"}
		}
		if v2 && signal.Count != len(signal.Occurrences) {
			return &AnalysisValidationError{Field: fmt.Sprintf("review_signals[%d].occurrences", index), Code: "count must match the occurrence list"}
		}
		seenOccurrences := make(map[string]struct{}, len(signal.Occurrences))
		for occurrenceIndex, occurrence := range signal.Occurrences {
			occurrenceField := fmt.Sprintf("review_signals[%d].occurrences[%d]", index, occurrenceIndex)
			if err := validateEventID(occurrence.EventID, occurrenceField+".event_id"); err != nil {
				return err
			}
			if _, duplicate := seenOccurrences[occurrence.EventID]; duplicate {
				return &AnalysisValidationError{Field: occurrenceField + ".event_id", Code: "duplicate occurrence event ID"}
			}
			seenOccurrences[occurrence.EventID] = struct{}{}
			if occurrence.EventKind != "" {
				if err := validateShortString(occurrence.EventKind, occurrenceField+".event_kind", true); err != nil {
					return err
				}
			}
			if err := validateRationale(occurrence.Summary, occurrenceField+".summary", false); err != nil {
				return err
			}
			if err := validateRationale(occurrence.Impact, occurrenceField+".impact", false); err != nil {
				return err
			}
		}
	}
	if result.JudgeAlignment.Status != "" && !validAlignmentStatus(result.JudgeAlignment.Status) {
		return &AnalysisValidationError{Field: "judge_alignment.status", Code: "unsupported value"}
	}
	if result.EvaluationLedger.Project == "" {
		return &AnalysisValidationError{Field: "evaluation_ledger.project", Code: "is required"}
	}
	if err := validateShortString(result.EvaluationLedger.Project, "evaluation_ledger.project", true); err != nil {
		return err
	}
	if len(result.EvaluationLedger.Improvements) > maxAnalysisRecords {
		return &AnalysisValidationError{Field: "evaluation_ledger.improvements", Code: "too many records"}
	}
	for index, improvement := range result.EvaluationLedger.Improvements {
		field := fmt.Sprintf("evaluation_ledger.improvements[%d]", index)
		for key, value := range map[string]string{"change": improvement.Change, "reason": improvement.Reason} {
			if err := validateRationale(value, field+"."+key, false); err != nil {
				return err
			}
		}
		if !v2 {
			if err := validateShortString(improvement.Path, field+".path", true); err != nil {
				return err
			}
			continue
		}
		if err := validateShortString(improvement.Path, field+".path", false); err != nil {
			return err
		}
		if !validImprovementTarget(improvement.TargetType) {
			return &AnalysisValidationError{Field: field + ".target_type", Code: "unsupported value"}
		}
		if improvement.TargetType == ImprovementAgentBehavior && strings.TrimSpace(improvement.Path) == "" {
			// A behavior-level action can target the agent without naming a file.
		} else if !isAgentInstructionPath(improvement.Path) {
			return &AnalysisValidationError{Field: field + ".path", Code: "must target agent instruction markdown"}
		}
		if improvement.TargetType == ImprovementSkillInstructions && !strings.Contains(strings.ToLower(improvement.Path), "/skills/") {
			return &AnalysisValidationError{Field: field + ".path", Code: "skill instruction target must be under a skills directory"}
		}
		if improvement.TargetType == ImprovementWorkflowInstructions && !strings.Contains(strings.ToLower(improvement.Path), "/workflows/") {
			return &AnalysisValidationError{Field: field + ".path", Code: "workflow instruction target must be under a workflows directory"}
		}
		if len(improvement.EvidenceEventIDs) == 0 {
			return &AnalysisValidationError{Field: field + ".evidence_event_ids", Code: "at least one evidence event is required"}
		}
		if err := validateEventIDList(improvement.EvidenceEventIDs, field+".evidence_event_ids"); err != nil {
			return err
		}
	}
	return nil
}

func (result *EvaluationResult) Normalize() {
	if result.ReviewSignals == nil {
		result.ReviewSignals = make([]ReviewSignal, 0)
	}
	if result.JudgeAlignment.Status == "" {
		result.JudgeAlignment.Status = AlignmentNotRecorded
	}
	if result.EvaluationLedger.Improvements == nil {
		result.EvaluationLedger.Improvements = make([]Improvement, 0)
	}
}

const (
	maxAnalysisRecords = 10000
	maxSourceLength    = 200
	maxRationaleLength = 8000
	maxShortLength     = 1000
)

func validAnalysisSchemaVersion(value string) bool {
	return strings.TrimSpace(value) == AnalysisSchemaVersion || strings.TrimSpace(value) == LegacyAnalysisSchemaVersion
}

func validateCoverage(result AnnotationResult) error {
	if result.Coverage == nil {
		return &AnalysisValidationError{Field: "coverage", Code: "schema version 2 requires counts for every evidence category"}
	}
	coverage := *result.Coverage
	if coverage.UserTurns == nil || coverage.AgentTurns == nil || coverage.ToolCalls == nil || coverage.SkillInvocations == nil || coverage.FileOperations == nil {
		return &AnalysisValidationError{Field: "coverage", Code: "schema version 2 requires counts for every evidence category"}
	}
	unclearUsers := 0
	for _, record := range result.UserTurns {
		if record.SignalType == UserSignalUnclear {
			unclearUsers++
		}
	}
	unclearTurns := 0
	for _, record := range result.Turns {
		if record.FollowsInstructions == AnnotationUnclear || record.Performance == PerformanceUnclear || record.ScopeAdherence == ScopeUnclear || record.Groundedness == GroundedUnclear || record.Verification == VerificationUnclear {
			unclearTurns++
		}
	}
	unclearTools := 0
	for _, record := range result.Tools {
		if record.Necessary == AnnotationUnclear || record.CompletionStatus == ToolUnknown {
			unclearTools++
		}
	}
	unclearSkills := 0
	for _, record := range result.Skills {
		if record.Necessary == AnnotationUnclear {
			unclearSkills++
		}
	}
	unclearFiles := 0
	for _, record := range result.Files {
		if record.Necessary == AnnotationUnclear {
			unclearFiles++
		}
	}
	categories := []struct {
		name    string
		value   *CoverageCategory
		labeled int
		unclear int
	}{
		{"user_turns", coverage.UserTurns, len(result.UserTurns), unclearUsers},
		{"agent_turns", coverage.AgentTurns, len(result.Turns), unclearTurns},
		{"tool_calls", coverage.ToolCalls, len(result.Tools), unclearTools},
		{"skill_invocations", coverage.SkillInvocations, len(result.Skills), unclearSkills},
		{"file_operations", coverage.FileOperations, len(result.Files), unclearFiles},
	}
	for _, category := range categories {
		if err := validateCoverageCategory(*category.value, category.name, category.labeled, category.unclear); err != nil {
			return err
		}
	}
	return nil
}

func validateCoverageCategory(value CoverageCategory, field string, labeled, unclear int) error {
	if value.Captured < 0 || value.Labeled < 0 || value.Unclear < 0 {
		return &AnalysisValidationError{Field: "coverage." + field, Code: "counts must be non-negative"}
	}
	if value.Captured != value.Labeled || value.Labeled != labeled || value.Unclear != unclear {
		return &AnalysisValidationError{Field: "coverage." + field, Code: "every captured record must have one annotation, and counts must match the annotation records"}
	}
	return nil
}

func validateEventIDList(values []string, field string) error {
	if len(values) > maxAnalysisRecords {
		return &AnalysisValidationError{Field: field, Code: "too many records"}
	}
	for index, value := range values {
		if err := validateEventID(value, fmt.Sprintf("%s[%d]", field, index)); err != nil {
			return err
		}
	}
	return nil
}

func isAgentInstructionPath(value string) bool {
	clean := path.Clean(strings.ReplaceAll(strings.TrimSpace(value), "\\", "/"))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") || strings.Contains(clean, ":") || !strings.EqualFold(path.Ext(clean), ".md") {
		return false
	}
	if strings.EqualFold(clean, "AGENTS.md") {
		return true
	}
	for _, root := range []string{".agents/", ".codex/", ".claude/", ".cursor/", ".github/", ".opencode/", ".windsurf/"} {
		if strings.HasPrefix(strings.ToLower(clean), root) {
			return true
		}
	}
	return false
}

func validateSource(value string) error {
	return validateShortString(value, "source", true, maxSourceLength)
}

func validateEventID(value, field string) error {
	return validateShortString(value, field, true, maxShortLength)
}

func validateOptionalEventID(value *string, field string) error {
	if value == nil {
		return nil
	}
	return validateEventID(*value, field)
}

func validateRationale(value, field string, optional bool) error {
	return validateShortString(value, field, !optional, maxRationaleLength)
}

func validateShortString(value, field string, required bool, limits ...int) error {
	trimmed := strings.TrimSpace(value)
	if required && trimmed == "" {
		return &AnalysisValidationError{Field: field, Code: "is required"}
	}
	limit := maxShortLength
	if len(limits) > 0 {
		limit = limits[0]
	}
	if len(trimmed) > limit {
		return &AnalysisValidationError{Field: field, Code: "is too long"}
	}
	return nil
}

func validAnnotationVerdict(value AnnotationVerdict) bool {
	return value == AnnotationYes || value == AnnotationNo || value == AnnotationUnclear
}

func validPerformanceVerdict(value PerformanceVerdict) bool {
	return value == PerformanceImproved || value == PerformanceNeutral || value == PerformanceWorsened || value == PerformanceUnclear
}

func validEvaluationVerdict(value EvaluationVerdict) bool {
	return value == EvaluationPass || value == EvaluationFail || value == EvaluationUnknown
}

func validAlignmentStatus(value AlignmentStatus) bool {
	return value == AlignmentAligned || value == AlignmentNotAligned || value == AlignmentNotRecorded
}

func validUserSignalType(value UserSignalType) bool {
	switch value {
	case UserSignalRequest, UserSignalConstraint, UserSignalClarification, UserSignalCorrection, UserSignalApproval, UserSignalRejection, UserSignalFeedback, UserSignalOther, UserSignalUnclear:
		return true
	default:
		return false
	}
}

func validScopeAdherence(value ScopeAdherence) bool {
	return value == ScopeWithin || value == ScopeDeviation || value == ScopeUnclear
}

func validGroundedness(value Groundedness) bool {
	return value == GroundedSupported || value == GroundedUnsupported || value == GroundedUnclear
}

func validVerificationStatus(value VerificationStatus) bool {
	return value == VerificationVerified || value == VerificationNotVerified || value == VerificationNotApplicable || value == VerificationUnclear
}

func validToolCompletionStatus(value ToolCompletionStatus) bool {
	return value == ToolCompleted || value == ToolIncomplete || value == ToolFailed || value == ToolUnknown
}

func validImprovementTarget(value ImprovementTarget) bool {
	return value == ImprovementAgentBehavior || value == ImprovementAgentInstructions || value == ImprovementSkillInstructions || value == ImprovementWorkflowInstructions
}
