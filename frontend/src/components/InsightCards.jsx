import { useState } from 'react'
import { normalizeSessionAnalysis } from '../sessionAnalysis'

const TONE_CLASSES = ['green', 'purple', 'amber']
const ALL_FILTER = 'all'
const EVIDENCE_TYPE_OPTIONS = [
  { value: ALL_FILTER, label: 'All evidence' },
  { value: 'turns', label: 'Agent turns' },
  { value: 'tools', label: 'Tool calls' },
  { value: 'skills', label: 'Skill invocations' },
]
const DECISION_OPTIONS = [
  { value: ALL_FILTER, label: 'All decisions' },
  { value: 'followsInstructions:yes', label: 'Follows instructions: Yes' },
  { value: 'followsInstructions:no', label: 'Follows instructions: No' },
  { value: 'followsInstructions:unclear', label: 'Follows instructions: Unclear' },
  { value: 'performance:improved', label: 'Performance: Improved' },
  { value: 'performance:neutral', label: 'Performance: Neutral' },
  { value: 'performance:worsened', label: 'Performance: Worsened' },
  { value: 'performance:unclear', label: 'Performance: Unclear' },
  { value: 'necessary:yes', label: 'Necessary for task: Yes' },
  { value: 'necessary:no', label: 'Necessary for task: No' },
  { value: 'necessary:unclear', label: 'Necessary for task: Unclear' },
]

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

function turnRoleLabel(role) {
  if (role === 'assistant') return 'Codex response'
  if (role === 'user') return 'User prompt'
  return 'Agent turn'
}

function EvidenceRecord({ category, record }) {
  if (category.key === 'turns') {
    const identifier = record.turnId ? `turn id: ${record.turnId}` : `event id: ${record.eventId}`
    return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{turnRoleLabel(record.turnRole)}</strong><code>{identifier}</code></div><div className="analysis-evidence-tags"><StatusPill tone={record.followsInstructions === 'no' ? 'critical' : record.followsInstructions === 'yes' ? 'positive' : 'unknown'}>Follows instructions: {evidenceValue(record.followsInstructions)}</StatusPill><StatusPill tone={record.performance === 'worsened' ? 'critical' : record.performance === 'improved' ? 'positive' : 'unknown'}>Performance: {evidenceValue(record.performance)}</StatusPill></div><div className="analysis-evidence-turn"><span>Captured content</span><p>{record.turnPreview || 'Turn content not recorded'}</p></div><p>{record.rationale}</p></li>
  }

  const label = category.key === 'skills' ? record.skillName : record.toolName || 'Tool name not recorded'
  const identifier = record.toolUseId ? `tool use: ${record.toolUseId}` : record.eventId
  return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{label}</strong><code>{identifier}</code></div><div className="analysis-evidence-tags"><StatusPill tone={record.necessary === 'no' ? 'critical' : record.necessary === 'yes' ? 'positive' : 'unknown'}>Necessary for task: {evidenceValue(record.necessary)}</StatusPill></div>{category.key === 'tools' && <div className="analysis-evidence-input"><span>{record.inputPreviewLabel || 'Tool details'}</span><code>{record.inputPreview || 'Tool input not recorded'}</code></div>}<p>{record.rationale}</p></li>
}

function Breakdown({ breakdowns }) {
  return <div className="analysis-breakdown">{breakdowns.map((breakdown) => <div className="analysis-breakdown-row" key={breakdown.label}><span>{breakdown.label}</span><div>{breakdown.values.map(({ value, count }) => <span className="analysis-breakdown-value" key={value}><strong>{count}</strong> {evidenceValue(value)}</span>)}</div></div>)}</div>
}

function AnnotationCategory({ category, visibleRecords, visibleBreakdowns, filtersActive }) {
  const unlabeledCount = category.capturedCount == null ? null : Math.max(category.capturedCount - category.annotatedCount, 0)
  const coverageDetail = category.capturedCount == null
    ? category.coverageDetail
    : `${category.coverageDetail}${unlabeledCount ? ` · ${unlabeledCount.toLocaleString()} not labeled` : ''}`
  return <article className="analysis-category-card"><div className="analysis-category-header"><div><span className="analysis-card-kicker">{category.label}</span><strong>{category.coverageValue}</strong><small>{coverageDetail}</small></div><StatusPill tone={annotationStatus(category)}>{category.annotatedCount ? 'Evidence recorded' : 'No annotations'}</StatusPill></div><Breakdown breakdowns={visibleBreakdowns} /><div className="analysis-evidence-heading"><span>Per-category evidence</span><strong>{filtersActive ? `${visibleRecords.length.toLocaleString()} matching / ${category.annotatedCount.toLocaleString()} labeled records` : `${category.annotatedCount.toLocaleString()} labeled records`}</strong></div>{visibleRecords.length ? <ul className="analysis-evidence-list">{visibleRecords.map((record, index) => <EvidenceRecord category={category} record={record} key={`${record.eventId}-${index}`} />)}</ul> : <p className="analysis-empty-copy">{filtersActive ? 'No records match the current filters.' : `No ${category.label.toLowerCase()} annotations recorded.`}</p>}</article>
}

function PerformanceSummary({ annotation }) {
  return <div className="analysis-performance-summary"><div className="analysis-subsection-heading"><span>Turn performance</span><strong>{annotation.performanceLabeledCount ? `${annotation.performanceLabeledCount} labeled` : 'Not recorded'}</strong></div><p className="analysis-performance-copy">Which annotated turns improved, stayed neutral, or worsened the result.</p>{annotation.performanceLabeledCount ? <div className="analysis-performance-values">{annotation.performanceSummary.map((item) => <div className={`analysis-performance-value ${item.value}`} key={item.value}><div><strong>{evidenceValue(item.value)}</strong><span>{item.count} {item.count === 1 ? 'turn' : 'turns'}</span></div>{item.count ? <div className="analysis-performance-turns">{item.turns.map((turn, index) => <span className="analysis-performance-turn" key={`${turn.id}-${index}`} title={turn.id}><strong>{turnRoleLabel(turn.role)}</strong><span>{turn.preview || 'Turn content not recorded'}</span></span>)}</div> : <em>None recorded</em>}</div>)}</div> : <p className="analysis-empty-copy">No turn performance labels were recorded.</p>}</div>
}

function categorySupportsDecision(category, decisionFilter) {
  if (decisionFilter === ALL_FILTER) return true
  const [field] = decisionFilter.split(':')
  return category.breakdowns.some((breakdown) => breakdown.key === field)
}

function recordMatchesDecision(record, decisionFilter) {
  if (decisionFilter === ALL_FILTER) return true
  const [field, value] = decisionFilter.split(':')
  return record[field] === value
}

function filteredCategory(category, evidenceType, decisionFilter) {
  const visibleRecords = category.records.filter((record) => recordMatchesDecision(record, decisionFilter))
  const visibleBreakdowns = category.breakdowns.map((breakdown) => ({
    ...breakdown,
    values: breakdown.values.map(({ value }) => ({
      value,
      count: visibleRecords.filter((record) => record[breakdown.key] === value).length,
    })),
  }))
  return { category, visibleRecords, visibleBreakdowns, evidenceType }
}

function AnnotationFilters({ evidenceType, decisionFilter, onEvidenceTypeChange, onDecisionChange, onClear, visibleCount, eligibleCount }) {
  const filtersActive = evidenceType !== ALL_FILTER || decisionFilter !== ALL_FILTER
  return <div className="analysis-filter-panel"><div className="analysis-filter-controls"><label>Evidence type<select aria-label="Evidence type" value={evidenceType} onChange={(event) => onEvidenceTypeChange(event.target.value)}>{EVIDENCE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Annotation decision<select aria-label="Annotation decision" value={decisionFilter} onChange={(event) => onDecisionChange(event.target.value)}>{DECISION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{filtersActive && <button type="button" className="analysis-filter-clear" onClick={onClear}>Clear filters</button>}</div><p className="analysis-filter-explanation">Follows instructions means whether the captured turn followed the applicable instructions. Necessary for task means whether the recorded tool or skill materially supported the requested outcome or required verification.</p><p className="analysis-filter-summary">Showing {visibleCount.toLocaleString()} of {eligibleCount.toLocaleString()} labeled records</p></div>
}

function AnnotationPanel({ annotation }) {
  const [evidenceType, setEvidenceType] = useState(ALL_FILTER)
  const [decisionFilter, setDecisionFilter] = useState(ALL_FILTER)

  if (!annotation.recorded) {
    return <section className="analysis-block annotation-block" aria-labelledby="annotation-title"><div className="analysis-block-heading"><div><span className="section-label">Annotation coverage</span><h3 id="annotation-title">Recorded decisions by category</h3><p>Each card shows labeled records / total records reconstructed from the trace. Unlabeled records are not failures.</p></div><StatusPill tone="unknown">Not recorded</StatusPill></div><div className="analysis-inline-empty"><strong>Annotation not recorded</strong><span>No turn, tool, or skill annotations were stored for this session.</span></div></section>
  }

  const filteredCategories = annotation.categories
    .filter((category) => evidenceType === ALL_FILTER || category.key === evidenceType)
    .filter((category) => categorySupportsDecision(category, decisionFilter))
    .map((category) => filteredCategory(category, evidenceType, decisionFilter))
  const eligibleCount = filteredCategories.reduce((total, item) => total + item.category.annotatedCount, 0)
  const visibleCount = filteredCategories.reduce((total, item) => total + item.visibleRecords.length, 0)
  const filtersActive = evidenceType !== ALL_FILTER || decisionFilter !== ALL_FILTER

  return <section className="analysis-block annotation-block" aria-labelledby="annotation-title"><div className="analysis-block-heading"><div><span className="section-label">Annotation coverage</span><h3 id="annotation-title">Recorded decisions by category</h3><p>Each card shows labeled records / total records reconstructed from the trace. Unlabeled records are not failures.</p></div><StatusPill tone="positive">Recorded</StatusPill></div><AnnotationFilters evidenceType={evidenceType} decisionFilter={decisionFilter} onEvidenceTypeChange={setEvidenceType} onDecisionChange={setDecisionFilter} onClear={() => { setEvidenceType(ALL_FILTER); setDecisionFilter(ALL_FILTER) }} visibleCount={visibleCount} eligibleCount={eligibleCount} /><PerformanceSummary annotation={annotation} /><div className="analysis-category-list">{filteredCategories.map(({ category, visibleRecords, visibleBreakdowns }) => <AnnotationCategory key={category.key} category={category} visibleRecords={visibleRecords} visibleBreakdowns={visibleBreakdowns} filtersActive={filtersActive} />)}</div></section>
}

function SignalOccurrence({ occurrence, index }) {
  return <li className="analysis-signal-occurrence"><span className="analysis-signal-occurrence-index">{index + 1}</span><div><strong>{occurrence.label}</strong><span>{occurrence.location}</span>{occurrence.input && <div className="analysis-signal-occurrence-input"><span>{occurrence.inputLabel || 'Recorded input'}</span><code>{occurrence.input}</code></div>}{occurrence.rationale && <p>{occurrence.rationale}</p>}</div></li>
}

function signalOccurrenceSummary(signal) {
  const available = signal.occurrences?.length || 0
  const total = signal.count
  if (total == null) return { headline: `${available.toLocaleString()} individual examples available`, detail: available ? 'The evaluator did not record a total occurrence count.' : 'No individual occurrence records were persisted.' }
  if (!available) return { headline: `0 individual occurrences available`, detail: `${total.toLocaleString()} occurrences were recorded only as an aggregate count; the evaluation payload contains no individual records.` }
  const missing = Math.max(total - available, 0)
  return { headline: `${available.toLocaleString()} ${available === 1 ? 'example' : 'examples'} shown of ${total.toLocaleString()} recorded ${total === 1 ? 'occurrence' : 'occurrences'}`, detail: missing ? `${missing.toLocaleString()} additional ${missing === 1 ? 'occurrence is' : 'occurrences are'} represented only by the aggregate count.` : null }
}

function ReviewSignals({ signals }) {
  const severityLabel = (severity) => severity.charAt(0).toUpperCase() + severity.slice(1)
  return <div className="analysis-subsection"><div className="analysis-subsection-heading"><span>Review signals</span><strong>{signals.length ? `${signals.length} observed` : 'Not recorded'}</strong></div>{signals.length ? <><p className="analysis-signal-legend">Warning = a review concern. Info = context, not a failure.</p><ul className="analysis-signal-list">{signals.map((signal, index) => { const summary = signalOccurrenceSummary(signal); return <li className={`analysis-signal-row ${signal.severity}`} key={`${signal.name}-${index}`}><div className="analysis-signal-body"><strong>{signal.name}</strong><span>{signal.detail}</span><em>{signal.severityMeaning}</em><div className="analysis-signal-occurrences"><div className="analysis-signal-occurrences-heading"><strong>Individual evidence</strong><span>{summary.headline}</span></div>{summary.detail && <p className="analysis-signal-occurrences-note">{summary.detail}</p>}{signal.occurrences?.length ? <ol>{signal.occurrences.map((occurrence, occurrenceIndex) => <SignalOccurrence key={`${occurrence.eventId || occurrence.label}-${occurrenceIndex}`} occurrence={occurrence} index={occurrenceIndex} />)}</ol> : <p className="analysis-empty-copy">No individual occurrence details are available in the saved evaluation.</p>}</div></div><StatusPill tone={signal.severity}>{signal.count == null ? 'Count not recorded' : `${signal.count.toLocaleString()} ${signal.count === 1 ? 'occurrence' : 'occurrences'} · ${severityLabel(signal.severity)}`}</StatusPill></li> })}</ul></> : <p className="analysis-empty-copy">No review signals were recorded by the evaluator.</p>}</div>
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
