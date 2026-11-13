import { Button } from '@ui-sdk/react/button'
import InsightCards from './InsightCards'
import { repairCapturedText } from '../sessionAnalysis'

function sessionIdFor(session) {
  return session.id || session.session_id || ''
}

export default function EvaluationPage({ session, analysis, analysisState = 'ready', analysisError, onAnalysisRetry, onBack }) {
  const sessionId = sessionIdFor(session)
  const sessionTitle = typeof session.title === 'string'
    ? repairCapturedText(session.title).trim() || sessionId || 'Untitled session'
    : sessionId || 'Untitled session'

  return <section className="trace-page evaluation-page" aria-labelledby="evaluation-page-title">
    <Button className="back-button" onClick={() => onBack()}>← <span>Session detail</span></Button>
    <div className="evaluation-heading">
      <div>
        <p className="eyebrow">REVIEW RECORD / SESSION EVALUATION</p>
        <h1 id="evaluation-page-title">Evaluation review</h1>
        <p>{sessionTitle} · {sessionId}</p>
      </div>
      <span className="source-note">stored review</span>
    </div>
    {analysisState === 'loading' && <div className="analysis-request-state" role="status" aria-live="polite"><span className="analysis-state-code">FETCH</span><strong>Loading saved evaluation</strong><span>Reading the session analysis without loading the full trace.</span></div>}
    {analysisState === 'error' && <div className="analysis-request-state error" role="alert"><span className="analysis-state-code">ERROR</span><strong>Saved evaluation could not be loaded</strong><span>{analysisError?.status === 401 ? 'Your sign-in may have expired. Sign in again, then retry this review.' : 'The analysis request failed. Your trace was not loaded as a fallback.'}</span><Button className="state-action" onClick={onAnalysisRetry}>Retry analysis request</Button></div>}
    {analysisState === 'missing' && <div className="analysis-request-state error" role="alert"><span className="analysis-state-code">404</span><strong>Session analysis was not found</strong><span>This session may not be available to your account. The full trace was not loaded.</span><Button className="state-action" onClick={onAnalysisRetry}>Retry analysis request</Button></div>}
    {analysisState === 'ready' && <InsightCards analysis={analysis} forceAnalysis sessionId={sessionId} />}
  </section>
}
