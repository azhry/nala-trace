import InsightCards from './InsightCards'

function sessionIdFor(session) {
  return session.id || session.session_id || ''
}

export default function EvaluationPage({ session, analysis, analysisState = 'ready', analysisError, onAnalysisRetry, onBack }) {
  const sessionId = sessionIdFor(session)
  const sessionTitle = session.title || sessionId || 'Untitled session'

  return <section className="page-section evaluation-page" aria-labelledby="evaluation-page-title">
    <button type="button" className="back-button" onClick={() => onBack()}>← <span>Session detail</span></button>
    <div className="detail-heading evaluation-heading">
      <div>
        <p className="eyebrow">Evaluation review</p>
        <h1 id="evaluation-page-title">Session evaluation</h1>
        <p>{sessionTitle} · {sessionId}</p>
      </div>
      <span className="source-note">stored review</span>
    </div>
    {analysisState === 'loading' && <div className="analysis-request-state" role="status" aria-live="polite"><strong>Loading saved evaluation</strong><span>Reading the session analysis without loading the full trace.</span></div>}
    {analysisState === 'error' && <div className="analysis-request-state error" role="alert"><strong>Saved evaluation could not be loaded</strong><span>{analysisError?.status === 401 ? 'Your sign-in may have expired. Sign in again, then retry this review.' : 'The analysis request failed. Your trace was not loaded as a fallback.'}</span><button type="button" className="state-action" onClick={onAnalysisRetry}>Retry analysis request</button></div>}
    {analysisState === 'missing' && <div className="analysis-request-state error" role="alert"><strong>Session analysis was not found</strong><span>This session may not be available to your account. The full trace was not loaded.</span><button type="button" className="state-action" onClick={onAnalysisRetry}>Retry analysis request</button></div>}
    {analysisState === 'ready' && <InsightCards analysis={analysis} forceAnalysis sessionId={sessionId} />}
  </section>
}
