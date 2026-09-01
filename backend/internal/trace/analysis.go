package trace

import (
	"fmt"
	"strings"
	"time"
)

const AnalysisSchemaVersion = "1"

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

type AnnotationResult struct {
	SchemaVersion string            `bson:"schema_version" json:"schema_version"`
	Source        string            `bson:"source" json:"source"`
	Turns         []TurnAnnotation  `bson:"turns" json:"turns"`
	Tools         []ToolAnnotation  `bson:"tools" json:"tools"`
	Skills        []SkillAnnotation `bson:"skills" json:"skills"`
}

type TurnAnnotation struct {
	EventID             string             `bson:"event_id" json:"event_id"`
	TurnID              *string            `bson:"turn_id" json:"turn_id"`
	FollowsInstructions AnnotationVerdict  `bson:"follows_instructions" json:"follows_instructions"`
	Performance         PerformanceVerdict `bson:"performance" json:"performance"`
	Rationale           string             `bson:"rationale" json:"rationale"`
}

type ToolAnnotation struct {
	EventID   string            `bson:"event_id" json:"event_id"`
	ToolUseID *string           `bson:"tool_use_id" json:"tool_use_id"`
	Necessary AnnotationVerdict `bson:"necessary" json:"necessary"`
	Rationale string            `bson:"rationale" json:"rationale"`
}

type SkillAnnotation struct {
	EventID   string            `bson:"event_id" json:"event_id"`
	SkillName string            `bson:"skill_name" json:"skill_name"`
	Necessary AnnotationVerdict `bson:"necessary" json:"necessary"`
	Rationale string            `bson:"rationale" json:"rationale"`
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
	Name     string `bson:"name" json:"name"`
	Count    int    `bson:"count" json:"count"`
	Severity string `bson:"severity" json:"severity"`
	Detail   string `bson:"detail" json:"detail"`
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
	Path   string `bson:"path" json:"path"`
	Change string `bson:"change" json:"change"`
	Reason string `bson:"reason" json:"reason"`
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
	if result.Turns == nil {
		result.Turns = make([]TurnAnnotation, 0)
	}
	if result.Tools == nil {
		result.Tools = make([]ToolAnnotation, 0)
	}
	if result.Skills == nil {
		result.Skills = make([]SkillAnnotation, 0)
	}
}

func (result AnnotationResult) Validate() error {
	if strings.TrimSpace(result.SchemaVersion) != AnalysisSchemaVersion {
		return &AnalysisValidationError{Field: "schema_version", Code: "unsupported value"}
	}
	if err := validateSource(result.Source); err != nil {
		return err
	}
	if len(result.Turns) > maxAnalysisRecords || len(result.Tools) > maxAnalysisRecords || len(result.Skills) > maxAnalysisRecords {
		return &AnalysisValidationError{Field: "records", Code: "too many records"}
	}
	for index, annotation := range result.Turns {
		if err := validateEventID(annotation.EventID, fmt.Sprintf("turns[%d].event_id", index)); err != nil {
			return err
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
	}
	for index, annotation := range result.Tools {
		if err := validateEventID(annotation.EventID, fmt.Sprintf("tools[%d].event_id", index)); err != nil {
			return err
		}
		if !validAnnotationVerdict(annotation.Necessary) {
			return &AnalysisValidationError{Field: fmt.Sprintf("tools[%d].necessary", index), Code: "unsupported value"}
		}
		if err := validateRationale(annotation.Rationale, fmt.Sprintf("tools[%d].rationale", index), false); err != nil {
			return err
		}
	}
	for index, annotation := range result.Skills {
		if err := validateEventID(annotation.EventID, fmt.Sprintf("skills[%d].event_id", index)); err != nil {
			return err
		}
		if !validAnnotationVerdict(annotation.Necessary) {
			return &AnalysisValidationError{Field: fmt.Sprintf("skills[%d].necessary", index), Code: "unsupported value"}
		}
		if err := validateRationale(annotation.Rationale, fmt.Sprintf("skills[%d].rationale", index), false); err != nil {
			return err
		}
	}
	return nil
}

func (result EvaluationResult) Validate() error {
	if strings.TrimSpace(result.SchemaVersion) != AnalysisSchemaVersion {
		return &AnalysisValidationError{Field: "schema_version", Code: "unsupported value"}
	}
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
		for field, value := range map[string]string{"path": improvement.Path, "change": improvement.Change, "reason": improvement.Reason} {
			if err := validateShortString(value, fmt.Sprintf("evaluation_ledger.improvements[%d].%s", index, field), true); err != nil {
				return err
			}
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

func validateSource(value string) error {
	return validateShortString(value, "source", true, maxSourceLength)
}

func validateEventID(value, field string) error {
	return validateShortString(value, field, true, maxShortLength)
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
