package storage

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/azhry/nala-trace/backend/internal/trace"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const sessionAnalysisCollectionName = "session_analysis"

type sessionAnalysisDocument struct {
	UserID     string                  `bson:"user_id"`
	SessionID  string                  `bson:"session_id"`
	Annotation *trace.AnnotationResult `bson:"annotation,omitempty"`
	Evaluation *trace.EvaluationResult `bson:"evaluation,omitempty"`
	UpdatedAt  time.Time               `bson:"updated_at"`
}

type SessionAnalysisRepository struct {
	upsertAnnotation func(context.Context, string, string, trace.AnnotationResult) (trace.Analysis, error)
	upsertEvaluation func(context.Context, string, string, trace.EvaluationResult) (trace.Analysis, error)
	find             func(context.Context, string, string) (trace.Analysis, error)
	createIndex      func(context.Context) error
}

type SessionAnalysisReader interface {
	GetSessionAnalysisForUser(context.Context, string, string) (trace.Analysis, error)
}

type SessionAnalysisWriter interface {
	SaveAnnotations(context.Context, string, string, trace.AnnotationResult) (trace.Analysis, error)
	SaveEvaluation(context.Context, string, string, trace.EvaluationResult) (trace.Analysis, error)
}

func NewSessionAnalysisRepository(database *mongo.Database) (*SessionAnalysisRepository, error) {
	if database == nil {
		return nil, &RepositoryError{Operation: "missing_database"}
	}
	collection := database.Collection(sessionAnalysisCollectionName)
	repository := &SessionAnalysisRepository{}
	repository.createIndex = func(ctx context.Context) error {
		_, err := collection.Indexes().CreateOne(ctx, mongo.IndexModel{
			Keys:    bson.D{{Key: "user_id", Value: 1}, {Key: "session_id", Value: 1}},
			Options: options.Index().SetUnique(true),
		})
		return err
	}
	repository.upsertAnnotation = func(ctx context.Context, userID, sessionID string, annotation trace.AnnotationResult) (trace.Analysis, error) {
		return upsertAnalysis(ctx, collection, userID, sessionID, bson.D{{Key: "annotation", Value: annotation}})
	}
	repository.upsertEvaluation = func(ctx context.Context, userID, sessionID string, evaluation trace.EvaluationResult) (trace.Analysis, error) {
		return upsertAnalysis(ctx, collection, userID, sessionID, bson.D{{Key: "evaluation", Value: evaluation}})
	}
	repository.find = func(ctx context.Context, userID, sessionID string) (trace.Analysis, error) {
		var document sessionAnalysisDocument
		err := collection.FindOne(ctx, bson.D{{Key: "user_id", Value: userID}, {Key: "session_id", Value: sessionID}}).Decode(&document)
		if errors.Is(err, mongo.ErrNoDocuments) {
			return trace.NewAnalysis(), nil
		}
		if err != nil {
			return trace.Analysis{}, err
		}
		return analysisFromDocument(document), nil
	}
	return repository, nil
}

func (r *SessionAnalysisRepository) EnsureIndexes(ctx context.Context) error {
	if r == nil || r.createIndex == nil {
		return &RepositoryError{Operation: "missing_analysis_index_repository"}
	}
	if err := r.createIndex(ctx); err != nil {
		return &RepositoryError{Operation: "create_session_analysis_index"}
	}
	return nil
}

func (r *SessionAnalysisRepository) SaveAnnotations(ctx context.Context, userID, sessionID string, annotation trace.AnnotationResult) (trace.Analysis, error) {
	if r == nil || r.upsertAnnotation == nil {
		return trace.Analysis{}, &RepositoryError{Operation: "missing_annotation_repository"}
	}
	if err := validateAnalysisScope(userID, sessionID); err != nil {
		return trace.Analysis{}, err
	}
	annotation.Normalize()
	if err := annotation.Validate(); err != nil {
		return trace.Analysis{}, err
	}
	result, err := r.upsertAnnotation(ctx, userID, sessionID, annotation)
	if err != nil {
		return trace.Analysis{}, &RepositoryError{Operation: "upsert_session_annotation"}
	}
	return result, nil
}

func (r *SessionAnalysisRepository) SaveEvaluation(ctx context.Context, userID, sessionID string, evaluation trace.EvaluationResult) (trace.Analysis, error) {
	if r == nil || r.upsertEvaluation == nil {
		return trace.Analysis{}, &RepositoryError{Operation: "missing_evaluation_repository"}
	}
	if err := validateAnalysisScope(userID, sessionID); err != nil {
		return trace.Analysis{}, err
	}
	evaluation.Normalize()
	if err := evaluation.Validate(); err != nil {
		return trace.Analysis{}, err
	}
	result, err := r.upsertEvaluation(ctx, userID, sessionID, evaluation)
	if err != nil {
		return trace.Analysis{}, &RepositoryError{Operation: "upsert_session_evaluation"}
	}
	return result, nil
}

func (r *SessionAnalysisRepository) GetSessionAnalysisForUser(ctx context.Context, userID, sessionID string) (trace.Analysis, error) {
	if r == nil || r.find == nil {
		return trace.Analysis{}, &RepositoryError{Operation: "missing_analysis_reader"}
	}
	if err := validateAnalysisScope(userID, sessionID); err != nil {
		return trace.Analysis{}, err
	}
	result, err := r.find(ctx, userID, sessionID)
	if err != nil {
		return trace.Analysis{}, &RepositoryError{Operation: "find_session_analysis"}
	}
	return result, nil
}

func upsertAnalysis(ctx context.Context, collection *mongo.Collection, userID, sessionID string, fields bson.D) (trace.Analysis, error) {
	updatedAt := time.Now().UTC()
	setFields := append(fields, bson.E{Key: "updated_at", Value: updatedAt})
	_, err := collection.UpdateOne(ctx,
		bson.D{{Key: "user_id", Value: userID}, {Key: "session_id", Value: sessionID}},
		bson.D{
			{Key: "$set", Value: setFields},
			{Key: "$setOnInsert", Value: bson.D{{Key: "user_id", Value: userID}, {Key: "session_id", Value: sessionID}}},
		},
		options.Update().SetUpsert(true),
	)
	if err != nil {
		return trace.Analysis{}, err
	}
	result := trace.NewAnalysis()
	result.UpdatedAt = &updatedAt
	if field := fields[0]; field.Key == "annotation" {
		annotation, ok := field.Value.(trace.AnnotationResult)
		if ok {
			result.Annotation = &annotation
		}
	} else if field := fields[0]; field.Key == "evaluation" {
		evaluation, ok := field.Value.(trace.EvaluationResult)
		if ok {
			result.Evaluation = &evaluation
		}
	}
	return result, nil
}

func analysisFromDocument(document sessionAnalysisDocument) trace.Analysis {
	return trace.Analysis{
		Annotation: document.Annotation,
		Evaluation: document.Evaluation,
		UpdatedAt:  timePointer(document.UpdatedAt),
	}
}

func timePointer(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	value = value.UTC()
	return &value
}

func validateAnalysisScope(userID, sessionID string) error {
	if strings.TrimSpace(userID) == "" {
		return &RepositoryError{Operation: "missing_user_id"}
	}
	if strings.TrimSpace(sessionID) == "" {
		return &RepositoryError{Operation: "missing_session_id"}
	}
	return nil
}
