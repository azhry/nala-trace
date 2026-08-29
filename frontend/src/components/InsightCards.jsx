import { normalizeSessionAnalysis } from '../sessionAnalysis'

const TONE_CLASSES = ['green', 'purple', 'amber']

function InsightCard({ metric, tone = '' }) {
  return <article className={`insight-card ${tone}`}><span>{metric.label}</span><strong>{metric.value}</strong><p>{metric.detail}</p></article>
}

function LegacyInsightCards({ insights = {} }) {
  const metrics = Array.isArray(insights.metrics) ? insights.metrics : []
  return <section className="insights-section" aria-labelledby="insights-title"><div className="section-heading-row"><div><p className="section-label">Review signal</p><h2 id="insights-title">What this session contains</h2><p className="section-description">These values come from the captured session metadata. No evaluation or judge result is invented when the rollout does not contain one.</p></div></div><div className="insight-grid">{metrics.map((metric, index) => <InsightCard key={metric.label} metric={metric} tone={TONE_CLASSES[index % TONE_CLASSES.length]} />)}</div><div className="recorded-signals"><div><span>Eval pass / fail</span><strong>{insights.evalPasses == null ? 'Not recorded' : `${insights.evalPasses}/${insights.evalTotal}`}</strong></div><div><span>Judge alignment</span><strong>{insights.judgeAlignment == null ? 'Not recorded' : `${insights.judgeAlignment}%`}</strong></div><div><span>Review signal</span><strong className="text-amber">{insights.reviewSignal || 'Not recorded'}</strong></div></div></section>
}

function StatusPill({ children, tone = 'unknown' }) {
  return <span className={`analysis-status-pill ${tone}`}>{children}</span>
}

function formatUpdatedAt(value) {
  if (!value) return 'Update time not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Update time not recorded' : `updated ${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
}

function annotationStatus(category) {
  return category.annotatedCount ? 'positive' : 'unknown'
}

function evidenceValue(value) {
  if (!value) return 'Not recorded'
  if (value === 'yes') return 'Yes'
  if (value === 'no') return 'No'
  if (value === 'improved') return 'Improved'
  if (value === 'neutral') return 'Neutral'
  if (value === 'worsened') return 'Worsened'
  return 'Unclear'
}

function EvidenceRecord({ category, record }) {
  if (category.key === 'turns') {
    return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{record.turnId ? `Turn ${record.turnId}` : 'Agent turn'}</strong><code>{record.eventId}</code></div><div className="analysis-evidence-tags"><StatusPill tone={record.followsInstructions === 'no' ? 'critical' : record.followsInstructions === 'yes' ? 'positive' : 'unknown'}>Instructions: {evidenceValue(record.followsInstructions)}</StatusPill><StatusPill tone={record.performance === 'worsened' ? 'critical' : record.performance === 'improved' ? 'positive' : 'unknown'}>Performance: {evidenceValue(record.performance)}</StatusPill></div><p>{record.rationale}</p></li>
  }

  const label = category.key === 'skills' ? record.skillName : record.toolName || 'Tool name not recorded'
  const identifier = record.toolUseId ? `tool use: ${record.toolUseId}` : record.eventId
  return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{label}</strong><code>{identifier}</code></div><div className="analysis-evidence-tags"><StatusPill tone={record.necessary === 'no' ? 'critical' : record.necessary === 'yes' ? 'positive' : 'unknown'}>Necessary: {evidenceValue(record.necessary)}</StatusPill></div>{category.key === 'tools' && <div className="analysis-evidence-input"><span>{record.inputPreviewLabel || 'Tool details'}</span><code>{record.inputPreview || 'Tool input not recorded'}</code></div>}<p>{record.rationale}</p></li>
}

function Breakdown({ breakdowns }) {
  return <div className="analysis-breakdown">{breakdowns.map((breakdown) => <div className="analysis-breakdown-row" key={breakdown.label}><span>{breakdown.label}</span><div>{breakdown.values.map(({ value, count }) => <span className="analysis-breakdown-value" key={value}><strong>{count}</strong> {evidenceValue(value)}</span>)}</div></div>)}</div>
}

function AnnotationCategory({ category }) {
  const unlabeledCount = category.capturedCount == null ? null : Math.max(category.capturedCount - category.annotatedCount, 0)
  const coverageDetail = category.capturedCount == null
    ? category.coverageDetail
    : `${category.coverageDetail}${unlabeledCount ? ` · ${unlabeledCount.toLocaleString()} not labeled` : ''}`
  return <article className="analysis-category-card"><div className="analysis-category-header"><div><span className="analysis-card-kicker">{category.label}</span><strong>{category.coverageValue}</strong><small>{coverageDetail}</small></div><StatusPill tone={annotationStatus(category)}>{category.annotatedCount ? 'Evidence recorded' : 'No annotations'}</StatusPill></div><Breakdown breakdowns={category.breakdowns} /><div className="analysis-evidence-heading"><span>Per-category evidence</span><strong>{category.annotatedCount.toLocaleString()} labeled records</strong></div>{category.records.length ? <ul className="analysis-evidence-list">{category.records.map((record, index) => <EvidenceRecord category={category} record={record} key={`${record.eventId}-${index}`} />)}</ul> : <p className="analysis-empty-copy">No {category.label.toLowerCase()} annotations recorded.</p>}</article>
}

function PerformanceSummary({ annotation }) {
  return <div className="analysis-performance-summary"><div className="analysis-subsection-heading"><span>Turn performance</span><strong>{annotation.performanceLabeledCount ? `${annotation.performanceLabeledCount} labeled` : 'Not recorded'}</strong></div><p className="analysis-performance-copy">Which annotated turns improved, stayed neutral, or worsened the result.</p>{annotation.performanceLabeledCount ? <div className="analysis-performance-values">{annotation.performanceSummary.map((item) => <div className={`analysis-performance-value ${item.value}`} key={item.value}><div><strong>{evidenceValue(item.value)}</strong><span>{item.count} {item.count === 1 ? 'turn' : 'turns'}</span></div>{item.count ? <code>{item.turnIds.join(', ')}</code> : <em>None recorded</em>}</div>)}</div> : <p className="analysis-empty-copy">No turn performance labels were recorded.</p>}</div>
}

function AnnotationPanel({ annotation }) {
  return <section className="analysis-block annotation-block" aria-labelledby="annotation-title"><div className="analysis-block-heading"><div><span className="section-label">Annotation coverage</span><h3 id="annotation-title">Recorded decisions by category</h3><p>Each card shows labeled records / total records reconstructed from the trace. Unlabeled records are not failures.</p></div><StatusPill tone={annotation.recorded ? 'positive' : 'unknown'}>{annotation.recorded ? 'Recorded' : 'Not recorded'}</StatusPill></div>{annotation.recorded ? <><PerformanceSummary annotation={annotation} /><div className="analysis-category-list">{annotation.categories.map((category) => <AnnotationCategory key={category.key} category={category} />)}</div></> : <div className="analysis-inline-empty"><strong>Annotation not recorded</strong><span>No turn, tool, or skill annotations were stored for this session.</span></div>}</section>
}

function ReviewSignals({ signals }) {
  return <div className="analysis-subsection"><div className="analysis-subsection-heading"><span>Review signals</span><strong>{signals.length ? `${signals.length} observed` : 'Not recorded'}</strong></div>{signals.length ? <ul className="analysis-signal-list">{signals.map((signal, index) => <li className={`analysis-signal-row ${signal.severity}`} key={`${signal.name}-${index}`}><div><strong>{signal.name}</strong><span>{signal.detail}</span></div><StatusPill tone={signal.severity}>{signal.count == null ? 'Count not recorded' : `${signal.count.toLocaleString()} · ${signal.severity}`}</StatusPill></li>)}</ul> : <p className="analysis-empty-copy">No review signals were recorded by the evaluator.</p>}</div>
}

function JudgeAlignment({ alignment }) {
  return <div className="analysis-subsection"><div className="analysis-subsection-heading"><span>Judge alignment</span><StatusPill tone={alignment.status === 'aligned' ? 'positive' : alignment.status === 'not_aligned' ? 'critical' : 'unknown'}>{alignment.label}</StatusPill></div><div className="analysis-alignment-grid">{alignment.humanLabel && <div><span>Human label</span><strong>{alignment.humanLabel}</strong></div>}{alignment.evaluatorLabel && <div><span>Evaluator label</span><strong>{alignment.evaluatorLabel}</strong></div>}{alignment.agreement !== null && <div><span>Agreement</span><strong>{alignment.agreement ? 'Agrees' : 'Does not agree'}</strong></div>}{alignment.dataset && <div><span>Dataset</span><strong>{alignment.dataset}</strong></div>}</div>{alignment.status === 'not_recorded' && <p className="analysis-empty-copy">Comparison unavailable: a human label and evaluator label were not both recorded.</p>}</div>
}

function ImprovementActions({ ledger }) {
  const improvements = ledger?.improvements || []
  const hasActions = improvements.length > 0

  return <section className={`analysis-block analysis-actions-block ${hasActions ? 'has-actions' : 'is-empty'}`} aria-labelledby="analysis-actions-title"><div className="analysis-block-heading"><div><span className="section-label">Evaluator actions</span><h3 id="analysis-actions-title">What to improve</h3><p>Concrete changes suggested by the evaluation.</p></div><StatusPill tone={hasActions ? 'positive' : 'unknown'}>{hasActions ? `${improvements.length.toLocaleString()} recorded` : 'No actions recorded'}</StatusPill></div>{hasActions ? <ol className="analysis-actions-list">{improvements.map((improvement, index) => <li key={`${improvement.path}-${index}`}><div className="analysis-action-field"><span>Path</span><code>{improvement.path}</code></div><div className="analysis-action-field"><span>Concrete change</span><strong>{improvement.change}</strong></div><div className="analysis-action-field"><span>Reason</span><p>{improvement.reason}</p></div></li>)}</ol> : <div className="analysis-inline-empty"><strong>No improvement actions recorded</strong><span>This evaluation did not record a concrete change to make.</span></div>}</section>
}

function EvaluationPanel({ evaluation }) {
  return <section className="analysis-block evaluation-block" aria-labelledby="evaluation-title"><div className="analysis-block-heading"><div><span className="section-label">Evaluation result</span><h3 id="evaluation-title">Verdict and review evidence</h3><p>Stored evaluator result and review evidence.</p></div><StatusPill tone={evaluation.verdict === 'pass' ? 'positive' : evaluation.verdict === 'fail' ? 'critical' : 'unknown'}>{evaluation.verdictLabel}</StatusPill></div>{evaluation.recorded ? <><div className="analysis-critique"><span>Critique</span><p>{evaluation.critique || 'Critique not recorded.'}</p></div><ReviewSignals signals={evaluation.reviewSignals} /><JudgeAlignment alignment={evaluation.judgeAlignment} /></> : <div className="analysis-inline-empty"><strong>Evaluation not recorded</strong><span>No verdict, critique, review signals, or judge comparison were stored for this session.</span></div>}</section>
}

function NoAnalysisState() {
  return <div className="analysis-empty-state" role="status"><span className="analysis-empty-mark" aria-hidden="true">—</span><strong>No analysis recorded</strong><p>This session has captured trace data, but no annotation or evaluation result has been stored yet.</p><div className="analysis-not-recorded-grid"><div><span>Annotation</span><strong>Not recorded</strong></div><div><span>Evaluation</span><strong>Not recorded</strong></div></div></div>
}

function sessionEvaluationPath(sessionId) {
  return `#/sessions/${encodeURIComponent(sessionId)}/evaluation`
}

function CompactAnalysisSummary({ analysis, sessionId }) {
  const actionCount = analysis.evaluation.evaluationLedger.improvements.length
  const evaluationHref = sessionId ? sessionEvaluationPath(sessionId) : null
  const improvedCount = analysis.annotation.performanceSummary.find((item) => item.value === 'improved')?.count || 0
  const worsenedCount = analysis.annotation.performanceSummary.find((item) => item.value === 'worsened')?.count || 0
  const performanceSummary = analysis.annotation.performanceLabeledCount ? `${improvedCount} improved · ${worsenedCount} worsened` : 'Not recorded'
  return <aside className="insights-section analysis-insights analysis-summary-card" aria-labelledby="analysis-summary-title"><div className="section-heading-row analysis-heading"><div><p className="section-label">Session analysis</p><h2 id="analysis-summary-title">Evaluation summary</h2><p className="section-description">Open the evaluation page for the recorded decisions and review evidence.</p></div><StatusPill tone={analysis.recorded ? 'positive' : 'unknown'}>{analysis.recorded ? 'Recorded' : 'Not recorded'}</StatusPill></div><div className="analysis-summary-metrics"><div><span>Annotation</span><strong>{analysis.annotation.recorded ? 'Recorded' : 'Not recorded'}</strong></div><div><span>Evaluation</span><strong>{analysis.evaluation.verdictLabel}</strong></div><div><span>Turn performance</span><strong>{performanceSummary}</strong></div><div><span>Improvements</span><strong>{analysis.evaluation.recorded ? actionCount.toLocaleString() : 'Not recorded'}</strong></div></div>{evaluationHref && <a className="analysis-summary-link" href={evaluationHref}>Open full evaluation <span aria-hidden="true">↗</span></a>}</aside>
}

function AnalysisCards({ analysis, compact = false, sessionId }) {
  if (compact) return <CompactAnalysisSummary analysis={analysis} sessionId={sessionId} />
  return <aside className={`insights-section analysis-insights analysis-full-page ${analysis.recorded ? '' : 'is-unrecorded'}`} aria-labelledby="analysis-details-title"><div className="section-heading-row analysis-heading"><div><p className="section-label">Evaluation review</p><h2 id="analysis-details-title">Recorded evaluation evidence</h2><p className="section-description">Stored decisions, evaluator results, and improvement actions for this session.</p></div><StatusPill tone={analysis.recorded ? 'positive' : 'unknown'}>{analysis.recorded ? 'Recorded' : 'Not recorded'}</StatusPill></div>{analysis.recorded ? <div className="analysis-content">{analysis.evaluation.recorded && <ImprovementActions ledger={analysis.evaluation.evaluationLedger} />}<AnnotationPanel annotation={analysis.annotation} /><EvaluationPanel evaluation={analysis.evaluation} /><p className="analysis-provenance">{[analysis.annotation.source && `annotation: ${analysis.annotation.source}`, analysis.evaluation.source && `evaluation: ${analysis.evaluation.source}`, formatUpdatedAt(analysis.updatedAt)].filter(Boolean).join(' · ') || 'Analysis provenance not recorded'}</p></div> : <NoAnalysisState />}</aside>
}

export default function InsightCards({ analysis, trace, insights, compact = false, sessionId, forceAnalysis = false }) {
  const isApiTrace = analysis !== undefined || Boolean(trace && (trace.schema_version || trace.conversation || trace.timeline))
  if (!isApiTrace && !forceAnalysis) return <LegacyInsightCards insights={insights} />
  return <AnalysisCards analysis={normalizeSessionAnalysis(analysis, trace)} compact={compact} sessionId={sessionId} />
}
