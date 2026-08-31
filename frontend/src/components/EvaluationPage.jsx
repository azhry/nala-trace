import InsightCards from './InsightCards'
import { TraceLoadingPanel } from './TraceView'

function sessionIdFor(session) {
  return session.id || session.session_id || ''
}

export default function EvaluationPage({ session, onBack, traceState = 'ready' }) {
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
    {traceState === 'loading' ? <TraceLoadingPanel /> : <InsightCards analysis={session.analysis} trace={session} forceAnalysis sessionId={sessionId} />}
  </section>
}
