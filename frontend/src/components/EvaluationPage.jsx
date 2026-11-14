import { Button } from '@ui-sdk/react/button'
import InsightCards from './InsightCards'
import { normalizeSessionAnalysis, repairCapturedText } from '../sessionAnalysis'

function sessionIdFor(session) {
  return session.id || session.session_id || ''
}

export default function EvaluationPage({ session, analysis, analysisState = 'ready', analysisError, onAnalysisRetry, onBack }) {
  const sessionId = sessionIdFor(session)
  const sessionTitle = typeof session.title === 'string'
    ? repairCapturedText(session.title).trim() || sessionId || 'Untitled session'
    : sessionId || 'Untitled session'
  const hasSavedAnalysis = analysisState === 'ready' && normalizeSessionAnalysis(analysis).recorded

  return <section className="trace-page evaluation-page" aria-labelledby="evaluation-page-title">
    <Button className="back-button" onClick={() => onBack()}>← <span>Session detail</span></Button>
    <div className="evaluation-heading">
      <div>
        <h1 id="evaluation-page-title">Evaluation</h1>
        <p>{sessionTitle === sessionId ? sessionId : `${sessionTitle} · ${sessionId}`}</p>
      </div>
      {hasSavedAnalysis && <span className="source-note" role="status">Saved</span>}
    </div>
    {analysisState === 'loading' && <div className="analysis-request-state" role="status" aria-live="polite"><span className="analysis-state-code">FETCH</span><strong>Loading saved evaluation</strong></div>}
    {analysisState === 'error' && <div className="analysis-request-state error" role="alert"><span className="analysis-state-code">ERROR</span><strong>Evaluation couldn’t be loaded</strong><span>{analysisError?.status === 401 ? 'Your sign-in may have expired. Sign in through Nala Labs, then retry.' : 'Try again in a moment.'}</span><Button className="state-action" onClick={onAnalysisRetry}>Retry</Button></div>}
    {analysisState === 'missing' && <div className="analysis-request-state error" role="alert"><span className="analysis-state-code">404</span><strong>No saved evaluation found</strong><span>This session may not be available to your account.</span><Button className="state-action" onClick={onAnalysisRetry}>Retry</Button></div>}
    {analysisState === 'ready' && <InsightCards analysis={analysis} forceAnalysis sessionId={sessionId} />}
  </section>
}
