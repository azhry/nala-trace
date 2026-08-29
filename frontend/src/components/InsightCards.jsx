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
  { value: 'followsInstructions:yes', label: 'Instruction following: Followed' },
  { value: 'followsInstructions:no', label: 'Instruction following: Not followed' },
  { value: 'followsInstructions:unclear', label: 'Instruction following: Unclear' },
  { value: 'performance:improved', label: 'Effect on result: Improved' },
  { value: 'performance:neutral', label: 'Effect on result: No visible effect' },
  { value: 'performance:worsened', label: 'Effect on result: Worsened' },
  { value: 'performance:unclear', label: 'Effect on result: Unclear' },
  { value: 'necessary:yes', label: 'Needed for task: Needed' },
  { value: 'necessary:no', label: 'Needed for task: Not needed' },
  { value: 'necessary:unclear', label: 'Needed for task: Unclear' },
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

function decisionLabel(field, value) {
  if (field === 'followsInstructions') {
    return value === 'yes' ? 'Followed' : value === 'no' ? 'Not followed' : 'Unclear'
  }
  if (field === 'performance') {
    return value === 'neutral' ? 'No visible effect' : evidenceValue(value)
  }
  if (field === 'necessary') {
    return value === 'yes' ? 'Needed' : value === 'no' ? 'Not needed' : 'Unclear'
  }
  return evidenceValue(value)
}

function turnRoleLabel(role) {
  if (role === 'assistant') return 'Codex response'
  if (role === 'user') return 'User prompt'
  return 'Agent turn'
}

function EvidenceRecord({ category, record }) {
  if (category.key === 'turns') {
    const identifier = record.turnId ? `turn id: ${record.turnId}` : `event id: ${record.eventId}`
    return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{turnRoleLabel(record.turnRole)}</strong><code>{identifier}</code></div><div className="analysis-evidence-tags"><StatusPill tone={record.followsInstructions === 'no' ? 'critical' : record.followsInstructions === 'yes' ? 'positive' : 'unknown'}>Instruction following: {decisionLabel('followsInstructions', record.followsInstructions)}</StatusPill><StatusPill tone={record.performance === 'worsened' ? 'critical' : record.performance === 'improved' ? 'positive' : 'unknown'}>Effect on result: {decisionLabel('performance', record.performance)}</StatusPill></div><div className="analysis-evidence-turn"><span>Captured content</span><p>{record.turnPreview || 'Turn content not recorded'}</p></div><p>{record.rationale}</p></li>
  }

  const label = category.key === 'skills' ? record.skillName : record.toolName || 'Tool name not recorded'
  const identifier = record.toolUseId ? `tool use: ${record.toolUseId}` : record.eventId
  return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{label}</strong><code>{identifier}</code></div><div className="analysis-evidence-tags"><StatusPill tone={record.necessary === 'no' ? 'critical' : record.necessary === 'yes' ? 'positive' : 'unknown'}>Needed for task: {decisionLabel('necessary', record.necessary)}</StatusPill></div>{category.key === 'tools' && <><div className="analysis-evidence-input"><span>{record.inputPreviewLabel || 'Tool details'}</span><code>{record.inputPreview || 'Tool input not recorded'}</code></div><div className="analysis-evidence-context"><span>Completion evidence</span><p>{record.completionDetail}</p></div></>}{category.key === 'skills' && <div className="analysis-evidence-context"><span>Captured invocation</span><code>{record.invocationDetail}</code></div>}<div className="analysis-evidence-context"><span>Decision basis</span><p>{record.rationale}</p></div></li>
}

function Breakdown({ breakdowns }) {
  return <div className="analysis-breakdown">{breakdowns.map((breakdown) => <div className="analysis-breakdown-row" key={breakdown.label}><span>{breakdown.label}</span><div>{breakdown.values.map(({ value, count }) => <span className="analysis-breakdown-value" key={value}><strong>{count}</strong> {evidenceValue(value)}</span>)}</div></div>)}</div>
}

function AnnotationCategory({ category, visibleRecords, visibleBreakdowns, filtersActive }) {
  const unlabeledCount = category.capturedCount == null ? null : Math.max(category.capturedCount - category.annotatedCount, 0)
  const coverageDetail = category.capturedCount == null
    ? category.coverageDetail
    : `${category.coverageDetail}${unlabeledCount ? ` · ${unlabeledCount.toLocaleString()} not labeled` : ''}`
  return <details className="analysis-category-card"><summary className="analysis-category-summary"><div className="analysis-category-header"><div><span className="analysis-card-kicker">{category.label}</span><strong>{category.coverageValue}</strong><small>{coverageDetail}</small></div><div className="analysis-category-summary-side"><StatusPill tone={annotationStatus(category)}>{category.annotatedCount ? 'Evidence recorded' : 'No annotations'}</StatusPill><span className="analysis-disclosure-hint">View details</span></div></div></summary><div className="analysis-category-content"><Breakdown breakdowns={visibleBreakdowns} /><div className="analysis-evidence-heading"><span>Evidence in this category</span><strong>{filtersActive ? `${visibleRecords.length.toLocaleString()} matching / ${category.annotatedCount.toLocaleString()} labeled records` : `${category.annotatedCount.toLocaleString()} labeled records`}</strong></div>{visibleRecords.length ? <ul className="analysis-evidence-list">{visibleRecords.map((record, index) => <EvidenceRecord category={category} record={record} key={`${record.eventId}-${index}`} />)}</ul> : <p className="analysis-empty-copy">{filtersActive ? 'No records match the current filters.' : `No ${category.label.toLowerCase()} annotations recorded.`}</p>}</div></details>
}

function PerformanceSummary({ annotation }) {
  return <div className="analysis-performance-summary"><div className="analysis-subsection-heading"><span>Turn performance</span><strong>{annotation.performanceLabeledCount ? `${annotation.performanceLabeledCount} labeled` : 'Not recorded'}</strong></div><p className="analysis-performance-copy">Improved means the turn moved the result forward; neutral means no observable effect; worsened means it added rework, risk, or regression.</p>{annotation.performanceLabeledCount ? <div className="analysis-performance-values">{annotation.performanceSummary.map((item) => <div className={`analysis-performance-value ${item.value}`} key={item.value}><div><strong>{evidenceValue(item.value)}</strong><span>{item.count} {item.count === 1 ? 'turn' : 'turns'}</span></div>{item.count ? <div className="analysis-performance-turns">{item.turns.map((turn, index) => <span className="analysis-performance-turn" key={`${turn.id}-${index}`} title={turn.id}><strong>{turnRoleLabel(turn.role)}</strong><span>{turn.preview || 'Turn content not recorded'}</span></span>)}</div> : <em>None recorded</em>}</div>)}</div> : <p className="analysis-empty-copy">No turn performance labels were recorded.</p>}</div>
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

  return <section className="analysis-block annotation-block" aria-labelledby="annotation-title"><div className="analysis-block-heading"><div><span className="section-label">Evidence reviewed</span><h3 id="annotation-title">How much of the session was reviewed</h3><p>These counts show labeled evidence versus captured evidence. Unlabeled records were not reviewed; they are not automatic failures.</p></div><StatusPill tone="positive">Recorded</StatusPill></div><AnnotationFilters evidenceType={evidenceType} decisionFilter={decisionFilter} onEvidenceTypeChange={setEvidenceType} onDecisionChange={setDecisionFilter} onClear={() => { setEvidenceType(ALL_FILTER); setDecisionFilter(ALL_FILTER) }} visibleCount={visibleCount} eligibleCount={eligibleCount} /><PerformanceSummary annotation={annotation} /><div className="analysis-category-list">{filteredCategories.map(({ category, visibleRecords, visibleBreakdowns }) => <AnnotationCategory key={category.key} category={category} visibleRecords={visibleRecords} visibleBreakdowns={visibleBreakdowns} filtersActive={filtersActive} />)}</div></section>
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
  return <div className="analysis-subsection"><div className="analysis-subsection-heading"><span>Review signals</span><strong>{signals.length ? `${signals.length} observed` : 'Not recorded'}</strong></div>{signals.length ? <><p className="analysis-signal-legend">Warnings need attention. Info items explain context and are not failures.</p><ul className="analysis-signal-list">{signals.map((signal, index) => { const summary = signalOccurrenceSummary(signal); return <li className={`analysis-signal-row ${signal.severity}`} key={`${signal.name}-${index}`}><div className="analysis-signal-body"><strong>{signal.name}</strong><span>{signal.detail}</span><em>{signal.severityMeaning}</em><details className="analysis-signal-details"><summary><strong>See evidence</strong><span>{summary.headline}</span></summary><div className="analysis-signal-occurrences">{summary.detail && <p className="analysis-signal-occurrences-note">{summary.detail}</p>}{signal.occurrences?.length ? <ol>{signal.occurrences.map((occurrence, occurrenceIndex) => <SignalOccurrence key={`${occurrence.eventId || occurrence.label}-${occurrenceIndex}`} occurrence={occurrence} index={occurrenceIndex} />)}</ol> : <p className="analysis-empty-copy">No individual occurrence details are available in the saved evaluation.</p>}</div></details></div><StatusPill tone={signal.severity}>{signal.count == null ? 'Count not recorded' : `${signal.count.toLocaleString()} ${signal.count === 1 ? 'occurrence' : 'occurrences'} · ${severityLabel(signal.severity)}`}</StatusPill></li> })}</ul></> : <p className="analysis-empty-copy">No review signals were recorded by the evaluator.</p>}</div>
}

function JudgeAlignment({ alignment }) {
  return <div className="analysis-subsection"><div className="analysis-subsection-heading"><span>Judge alignment</span><StatusPill tone={alignment.status === 'aligned' ? 'positive' : alignment.status === 'not_aligned' ? 'critical' : 'unknown'}>{alignment.label}</StatusPill></div><div className="analysis-alignment-grid">{alignment.humanLabel && <div><span>Human label</span><strong>{alignment.humanLabel}</strong></div>}{alignment.evaluatorLabel && <div><span>Evaluator label</span><strong>{alignment.evaluatorLabel}</strong></div>}{alignment.agreement !== null && <div><span>Agreement</span><strong>{alignment.agreement ? 'Agrees' : 'Does not agree'}</strong></div>}{alignment.dataset && <div><span>Dataset</span><strong>{alignment.dataset}</strong></div>}</div>{alignment.status === 'not_recorded' && <p className="analysis-empty-copy">Comparison unavailable: a human label and evaluator label were not both recorded.</p>}</div>
}

function reviewConcernSignals(signals = []) {
  return signals.filter((signal) => signal.severity === 'warning' || signal.severity === 'critical')
}

function evidenceCoverage(category) {
  if (!category) return { value: 'Not recorded', detail: 'agent turns labeled' }
  if (category.capturedCount == null) return { value: `${category.annotatedCount.toLocaleString()} labeled`, detail: 'agent turns · total unavailable' }
  return { value: `${category.annotatedCount.toLocaleString()} / ${category.capturedCount.toLocaleString()}`, detail: 'agent turns labeled' }
}

function overviewReadout(verdict) {
  if (verdict === 'pass') return 'The evaluation passed.'
  if (verdict === 'fail') return 'The evaluation found issues that need attention.'
  return 'The evaluator did not record a definitive verdict.'
}

function EvaluationOverview({ analysis }) {
  const { annotation, evaluation } = analysis
  const concerns = reviewConcernSignals(evaluation.reviewSignals)
  const coverage = evidenceCoverage(annotation.categories.find((category) => category.key === 'turns'))
  const signalCount = evaluation.reviewSignals.length
  const concernOccurrences = concerns.reduce((total, signal) => total + (signal.count || 0), 0)
  const concernValue = concerns.length ? concerns.length.toLocaleString() : 'None'
  const concernDetail = concerns.length
    ? `${concerns.length === 1 ? 'warning or critical signal' : 'warning or critical signals'} · ${concernOccurrences.toLocaleString()} recorded occurrences`
    : `${signalCount.toLocaleString()} ${signalCount === 1 ? 'signal' : 'signals'} observed`
  const followUpCount = evaluation.followUps.length

  return <section className={`analysis-overview ${evaluation.verdict}`} aria-labelledby="analysis-overview-title"><div className="analysis-overview-readout"><span className="section-label">Evaluation summary</span><h3 id="analysis-overview-title">Review at a glance</h3><strong className="analysis-overview-verdict">{overviewReadout(evaluation.verdict)}</strong><p>{evaluation.critique || 'No written critique was recorded.'}</p></div><div className="analysis-overview-stats"><div><span>Outcome</span><strong>{evaluation.verdictLabel}</strong><small>evaluator result</small></div><div><span>Findings</span><strong>{concernValue}</strong><small>{concernDetail}</small></div><div><span>Next steps</span><strong>{followUpCount ? followUpCount.toLocaleString() : 'None'}</strong><small>{followUpCount ? 'follow-ups to address' : 'no follow-ups recorded'}</small></div><div><span>Evidence reviewed</span><strong>{coverage.value}</strong><small>{coverage.detail}</small></div></div></section>
}

function EvidenceDisclosure({ annotation, evaluation }) {
  const categories = annotation.categories
  const categoryCount = categories.filter((category) => category.annotatedCount > 0).length
  const concernCount = reviewConcernSignals(evaluation.reviewSignals).length
  const evidenceSummary = [
    `${categoryCount} ${categoryCount === 1 ? 'category' : 'categories'} reviewed`,
    `${evaluation.reviewSignals.length} ${evaluation.reviewSignals.length === 1 ? 'signal' : 'signals'}`,
    concernCount ? `${concernCount} ${concernCount === 1 ? 'concern' : 'concerns'}` : 'no concerns',
  ].join(' · ')

  return <details className="analysis-evidence-disclosure"><summary><span className="analysis-disclosure-summary-copy"><span className="section-label">Audit trail</span><strong>Evidence details</strong><span>Open the captured turns, tool calls, skills, signals, and judge comparison behind this review.</span></span><span className="analysis-disclosure-summary-meta">{evidenceSummary}<span className="analysis-disclosure-toggle">Open details</span></span></summary><div className="analysis-disclosure-content"><AnnotationPanel annotation={annotation} /><EvaluationPanel evaluation={evaluation} /></div></details>
}

function ImprovementActions({ ledger, followUps = [] }) {
  const improvements = ledger?.improvements || []
  const hasActions = improvements.length > 0
  const hasFollowUps = followUps.length > 0
  const recordedLabel = `${improvements.length.toLocaleString()} recorded evaluator ${improvements.length === 1 ? 'action' : 'actions'}`
  const followUpLabel = `${followUps.length.toLocaleString()} ${followUps.length === 1 ? 'follow-up' : 'follow-ups'} from warning findings`
  const followUpStatusLabel = `${followUps.length.toLocaleString()} ${followUps.length === 1 ? 'follow-up' : 'follow-ups'}`

  return <section className={`analysis-block analysis-actions-block ${hasActions || hasFollowUps ? 'has-actions' : 'is-empty'}`} aria-labelledby="analysis-actions-title"><div className="analysis-block-heading"><div><span className="section-label">Action plan</span><h3 id="analysis-actions-title">What to improve</h3><p>Concrete changes to make next. Evaluator actions are separated from follow-ups generated by warning findings.</p></div><StatusPill tone={hasActions || hasFollowUps ? 'positive' : 'unknown'}>{[hasActions && `${improvements.length.toLocaleString()} recorded`, hasFollowUps && followUpStatusLabel].filter(Boolean).join(' · ') || 'No actions recorded'}</StatusPill></div>{hasActions && <div className="analysis-actions-group"><div className="analysis-actions-group-heading"><strong>Recorded changes</strong><span>{recordedLabel}</span></div><ol className="analysis-actions-list">{improvements.map((improvement, index) => <li key={`${improvement.path}-${index}`}><div className="analysis-action-field"><span>Change</span><strong>{improvement.change}</strong></div><div className="analysis-action-field"><span>Where</span><code>{improvement.path}</code></div><div className="analysis-action-field"><span>Why</span><p>{improvement.reason}</p></div></li>)}</ol></div>}{hasFollowUps && <div className="analysis-actions-group analysis-derived-actions"><div className="analysis-actions-group-heading"><strong>Follow-ups to address</strong><span>{followUpLabel}</span></div><ol className="analysis-actions-list">{followUps.map((followUp, index) => <li key={`${followUp.signalKey}-${index}`}><div className="analysis-action-field"><span>Finding</span><strong>{followUp.title}</strong></div><div className="analysis-action-field"><span>Next step</span><strong>{followUp.action}</strong></div><div className="analysis-action-field"><span>Why this is here</span><p>{followUp.reason}</p></div>{followUp.occurrenceCount != null && <div className="analysis-action-field"><span>Recorded occurrences</span><span>{followUp.occurrenceCount.toLocaleString()}</span></div>}<span className="analysis-action-source">Derived from warning finding</span></li>)}</ol></div>}{!hasActions && !hasFollowUps && <div className="analysis-inline-empty"><strong>No improvement actions recorded</strong><span>This evaluation did not record a concrete change to make.</span></div>}</section>
}

function EvaluationPanel({ evaluation }) {
  return <section className="analysis-block evaluation-block" aria-labelledby="evaluation-title"><div className="analysis-block-heading"><div><span className="section-label">Evaluation result</span><h3 id="evaluation-title">Findings and comparison</h3><p>Open this section when you need the signal details or judge comparison behind the summary.</p></div><StatusPill tone={evaluation.verdict === 'pass' ? 'positive' : evaluation.verdict === 'fail' ? 'critical' : 'unknown'}>{evaluation.verdictLabel}</StatusPill></div>{evaluation.recorded ? <><ReviewSignals signals={evaluation.reviewSignals} /><JudgeAlignment alignment={evaluation.judgeAlignment} /></> : <div className="analysis-inline-empty"><strong>Evaluation not recorded</strong><span>No verdict, critique, review signals, or judge comparison were stored for this session.</span></div>}</section>
}

function NoAnalysisState() {
  return <div className="analysis-empty-state" role="status"><span className="analysis-empty-mark" aria-hidden="true">—</span><strong>No analysis recorded</strong><p>This session has captured trace data, but no annotation or evaluation result has been stored yet.</p><div className="analysis-not-recorded-grid"><div><span>Annotation</span><strong>Not recorded</strong></div><div><span>Evaluation</span><strong>Not recorded</strong></div></div></div>
}

function sessionEvaluationPath(sessionId) {
  return `#/sessions/${encodeURIComponent(sessionId)}/evaluation`
}

function CompactAnalysisSummary({ analysis, sessionId }) {
  const actionCount = analysis.evaluation.evaluationLedger.improvements.length
  const followUpCount = analysis.evaluation.followUps.length
  const evaluationHref = sessionId ? sessionEvaluationPath(sessionId) : null
  const improvedCount = analysis.annotation.performanceSummary.find((item) => item.value === 'improved')?.count || 0
  const worsenedCount = analysis.annotation.performanceSummary.find((item) => item.value === 'worsened')?.count || 0
  const performanceSummary = analysis.annotation.performanceLabeledCount ? `${improvedCount} improved · ${worsenedCount} worsened` : 'Not recorded'
  const actionableItems = analysis.evaluation.recorded
    ? [actionCount ? `${actionCount.toLocaleString()} recorded` : null, followUpCount ? `${followUpCount.toLocaleString()} ${followUpCount === 1 ? 'follow-up' : 'follow-ups'}` : null].filter(Boolean).join(' · ') || 'None recorded'
    : 'Not recorded'
  return <aside className="insights-section analysis-insights analysis-summary-card" aria-labelledby="analysis-summary-title"><div className="section-heading-row analysis-heading"><div><p className="section-label">Session analysis</p><h2 id="analysis-summary-title">Evaluation summary</h2><p className="section-description">Open the evaluation page for the recorded decisions and review evidence.</p></div><StatusPill tone={analysis.recorded ? 'positive' : 'unknown'}>{analysis.recorded ? 'Recorded' : 'Not recorded'}</StatusPill></div><div className="analysis-summary-metrics"><div><span>Annotation</span><strong>{analysis.annotation.recorded ? 'Recorded' : 'Not recorded'}</strong></div><div><span>Evaluation</span><strong>{analysis.evaluation.verdictLabel}</strong></div><div><span>Turn performance</span><strong>{performanceSummary}</strong></div><div><span>Actionable items</span><strong>{actionableItems}</strong></div></div>{evaluationHref && <a className="analysis-summary-link" href={evaluationHref}>Open full evaluation <span aria-hidden="true">↗</span></a>}</aside>
}

function AnalysisCards({ analysis, compact = false, sessionId }) {
  if (compact) return <CompactAnalysisSummary analysis={analysis} sessionId={sessionId} />
  return <aside className={`insights-section analysis-insights analysis-full-page ${analysis.recorded ? '' : 'is-unrecorded'}`} aria-labelledby="analysis-details-title"><div className="section-heading-row analysis-heading"><div><p className="section-label">Evaluation review</p><h2 id="analysis-details-title">Review details</h2><p className="section-description">Start with the outcome and next steps. Open the audit trail when you need the captured evidence.</p></div><StatusPill tone={analysis.recorded ? 'positive' : 'unknown'}>{analysis.recorded ? 'Recorded' : 'Not recorded'}</StatusPill></div>{analysis.recorded ? <div className="analysis-content">{analysis.evaluation.recorded && <EvaluationOverview analysis={analysis} />}{analysis.evaluation.recorded && <ImprovementActions ledger={analysis.evaluation.evaluationLedger} followUps={analysis.evaluation.followUps} />}{analysis.evaluation.recorded ? <EvidenceDisclosure annotation={analysis.annotation} evaluation={analysis.evaluation} /> : <AnnotationPanel annotation={analysis.annotation} />}</div> : <NoAnalysisState />}</aside>
}

export default function InsightCards({ analysis, trace, insights, compact = false, sessionId, forceAnalysis = false }) {
  const isApiTrace = analysis !== undefined || Boolean(trace && (trace.schema_version || trace.conversation || trace.timeline))
  if (!isApiTrace && !forceAnalysis) return <LegacyInsightCards insights={insights} />
  return <AnalysisCards analysis={normalizeSessionAnalysis(analysis, trace)} compact={compact} sessionId={sessionId} />
}
