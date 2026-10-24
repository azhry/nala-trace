import { useState } from 'react'
import { normalizeSessionAnalysis } from '../sessionAnalysis'

const TONE_CLASSES = ['green', 'purple', 'amber']
const ALL_FILTER = 'all'
const EVIDENCE_TYPE_OPTIONS = [
  { value: ALL_FILTER, label: 'All evidence' },
  { value: 'user_turns', label: 'User turns' },
  { value: 'turns', label: 'Agent turns' },
  { value: 'tools', label: 'Tool calls' },
  { value: 'skills', label: 'Skill invocations' },
  { value: 'files', label: 'File operations' },
  { value: 'capture_gaps', label: 'Capture gaps' },
]
const DECISION_OPTIONS = [
  { value: ALL_FILTER, label: 'All decisions' },
  { value: 'followsInstructions:yes', label: 'Instruction following: Followed' },
  { value: 'followsInstructions:no', label: 'Instruction following: Not followed' },
  { value: 'followsInstructions:unclear', label: 'Instruction following: Unclear' },
  { value: 'scopeAdherence:within_scope', label: 'Scope: Within request' },
  { value: 'scopeAdherence:deviation', label: 'Scope: Went outside request' },
  { value: 'scopeAdherence:unclear', label: 'Scope: Unclear' },
  { value: 'groundedness:supported', label: 'Claims: Supported by evidence' },
  { value: 'groundedness:unsupported', label: 'Claims: Unsupported' },
  { value: 'groundedness:unclear', label: 'Claims: Unclear' },
  { value: 'verification:verified', label: 'Verification: Verified' },
  { value: 'verification:not_verified', label: 'Verification: Not verified' },
  { value: 'verification:not_applicable', label: 'Verification: Not applicable' },
  { value: 'performance:improved', label: 'Effect on result: Improved' },
  { value: 'performance:neutral', label: 'Effect on result: No outcome change recorded' },
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
  return category.recorded && category.annotatedCount ? 'positive' : 'unknown'
}

function evidenceValue(value) {
  if (!value) return 'Not recorded'
  if (value === 'yes') return 'Yes'
  if (value === 'no') return 'No'
  if (value === 'improved') return 'Improved'
  if (value === 'neutral') return 'No outcome change recorded'
  if (value === 'worsened') return 'Worsened'
  return 'Unclear'
}

function decisionLabel(field, value) {
  if (field === 'followsInstructions') {
    return value === 'yes' ? 'Followed' : value === 'no' ? 'Not followed' : 'Unclear'
  }
  if (field === 'performance') {
    return value === 'neutral' ? 'No outcome change recorded' : evidenceValue(value)
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
  if (category.key === 'user_turns') {
    return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{record.signalType}</strong><code>event id: {record.eventId}</code></div><div className="analysis-evidence-turn"><span>What the user said</span><p>{record.summary || 'This v1 result did not save a readable user-turn summary.'}</p></div>{record.rationale && <div className="analysis-evidence-context"><span>Why this message was classified this way</span><p>{record.rationale}</p></div>}{record.relatedEventIds.length > 0 && <RelatedEvents eventIds={record.relatedEventIds} />}</li>
  }

  if (category.key === 'turns') {
    const identifier = record.turnId ? `turn id: ${record.turnId}` : `event id: ${record.eventId}`
    return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{turnRoleLabel(record.turnRole)}</strong><code>{identifier}</code></div><div className="analysis-evidence-tags"><StatusPill tone={record.followsInstructions === 'no' ? 'critical' : record.followsInstructions === 'yes' ? 'positive' : 'unknown'}>Instruction adherence: {decisionLabel('followsInstructions', record.followsInstructions)}</StatusPill>{record.scopeAdherence && <StatusPill tone={record.scopeAdherence === 'deviation' ? 'critical' : record.scopeAdherence === 'within_scope' ? 'positive' : 'unknown'}>Scope: {humanLabel(record.scopeAdherence)}</StatusPill>}{record.groundedness && <StatusPill tone={record.groundedness === 'unsupported' ? 'critical' : record.groundedness === 'supported' ? 'positive' : 'unknown'}>Claims: {humanLabel(record.groundedness)}</StatusPill>}{record.verification && <StatusPill tone={record.verification === 'not_verified' ? 'warning' : record.verification === 'verified' ? 'positive' : 'unknown'}>Verification: {humanLabel(record.verification)}</StatusPill>}{record.performance && <StatusPill tone={record.performance === 'worsened' ? 'critical' : record.performance === 'improved' ? 'positive' : 'unknown'}>Effect on result: {decisionLabel('performance', record.performance)}</StatusPill>}</div><div className="analysis-evidence-turn"><span>Agent response</span><p>{record.responseSummary || 'This v1 result did not save a response summary.'}</p></div>{record.rationale && <div className="analysis-evidence-context"><span>Why this label was applied</span><p>{record.rationale}</p></div>}{record.relatedEventIds.length > 0 && <RelatedEvents eventIds={record.relatedEventIds} />}</li>
  }

  if (category.key === 'files') {
    return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{record.operation}</strong><code>event id: {record.eventId}</code></div><div className="analysis-evidence-context"><span>File</span><code>{record.path}</code></div>{record.summary && <div className="analysis-evidence-context"><span>What happened</span><p>{record.summary}</p></div>}{record.necessary && <StatusPill tone={record.necessary === 'no' ? 'critical' : record.necessary === 'yes' ? 'positive' : 'unknown'}>Relevance: {decisionLabel('necessary', record.necessary)}</StatusPill>}{record.rationale && <div className="analysis-evidence-context"><span>Why this label was applied</span><p>{record.rationale}</p></div>}</li>
  }

  const label = category.key === 'skills' ? record.skillName : record.toolName || 'Tool name not recorded'
  const identifier = record.toolUseId ? `tool use: ${record.toolUseId}` : `event id: ${record.eventId}`
  return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{label}</strong><code>{identifier}</code></div><div className="analysis-evidence-tags"><StatusPill tone={record.necessary === 'no' ? 'critical' : record.necessary === 'yes' ? 'positive' : 'unknown'}>Needed for task: {decisionLabel('necessary', record.necessary)}</StatusPill></div>{category.key === 'tools' && <><div className="analysis-evidence-input"><span>{record.inputPreviewLabel || 'Command or input'}</span><code>{record.inputPreview || 'Input summary not included in this analysis version.'}</code></div><div className="analysis-evidence-context"><span>Tool result</span><p>{record.outputSummary || 'Output summary not included in this analysis version.'}</p></div><div className="analysis-evidence-context"><span>Completion evidence</span><p>{record.completionDetail}</p></div></>}{category.key === 'skills' && <div className="analysis-evidence-context"><span>Skill use</span><p>{record.summary || 'Summary not included in this analysis version.'}</p></div>}{record.rationale && <div className="analysis-evidence-context"><span>Why this label was applied</span><p>{record.rationale}</p></div>}</li>
}

function humanLabel(value) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function RelatedEvents({ eventIds }) {
  return <div className="analysis-evidence-context"><span>Related captured events</span><ul className="analysis-related-events">{eventIds.map((eventId) => <li key={eventId}><code>{eventId}</code></li>)}</ul></div>
}

function Breakdown({ breakdowns }) {
  return <div className="analysis-breakdown">{breakdowns.map((breakdown) => <div className="analysis-breakdown-row" key={breakdown.label}><span>{breakdown.label}</span><div>{breakdown.values.map(({ value, count }) => <span className="analysis-breakdown-value" key={value}><strong>{count}</strong> {evidenceValue(value)}</span>)}</div></div>)}</div>
}

function AnnotationCategory({ category, visibleRecords, visibleBreakdowns, filtersActive }) {
  const unlabeledCount = category.capturedCount == null ? null : Math.max(category.capturedCount - category.annotatedCount, 0)
  const coverageDetail = category.capturedCount == null
    ? category.coverageDetail
    : `${category.coverageDetail}${unlabeledCount ? ` · ${unlabeledCount.toLocaleString()} not labeled` : ''}`
  const stateLabel = !category.recorded ? 'Not included in this analysis' : category.annotatedCount ? 'Evidence recorded' : 'No labels recorded'
  return <details className="analysis-category-card"><summary className="analysis-category-summary"><div className="analysis-category-header"><div><span className="analysis-card-kicker">{category.label}</span><strong>{category.coverageValue}</strong><small>{category.recorded ? coverageDetail : category.unavailableDetail || coverageDetail}</small>{category.recorded && <small className="analysis-category-unclear">{category.unclearCount ? `${category.unclearCount.toLocaleString()} ${category.unclearCount === 1 ? 'record has' : 'records have'} one or more unclear decisions.` : 'No records have an unclear decision.'}</small>}</div><div className="analysis-category-summary-side"><StatusPill tone={annotationStatus(category)}>{stateLabel}</StatusPill><span className="analysis-disclosure-hint">Open records</span></div></div></summary><div className="analysis-category-content">{category.recorded && <Breakdown breakdowns={visibleBreakdowns} />}{category.recorded && <div className="analysis-evidence-heading"><span>Saved evidence in this category</span><strong>{filtersActive ? `${visibleRecords.length.toLocaleString()} matching / ${category.annotatedCount.toLocaleString()} labeled records` : `${category.annotatedCount.toLocaleString()} labeled records`}</strong></div>}{visibleRecords.length ? <ul className="analysis-evidence-list">{visibleRecords.map((record, index) => <EvidenceRecord category={category} record={record} key={`${record.eventId}-${index}`} />)}</ul> : <p className="analysis-empty-copy">{!category.recorded ? category.unavailableDetail || 'This category was not stored in the saved analysis.' : filtersActive ? 'No records match the current filters.' : `No ${category.label.toLowerCase()} labels were stored.`}</p>}</div></details>
}

function PerformanceSummary({ annotation }) {
  return <div className="analysis-performance-summary"><div className="analysis-subsection-heading"><span>Effect on the result</span><strong>{annotation.performanceLabeledCount ? `${annotation.performanceLabeledCount} agent turns labeled` : 'Not recorded'}</strong></div><p className="analysis-performance-copy">“No outcome change recorded” means the evaluator did not see this turn change the result. It does not mean the response was good or bad.</p>{annotation.performanceLabeledCount ? <div className="analysis-performance-values">{annotation.performanceSummary.map((item) => <div className={`analysis-performance-value ${item.value}`} key={item.value}><div><strong>{evidenceValue(item.value)}</strong><span>{item.count} {item.count === 1 ? 'agent turn' : 'agent turns'}</span></div>{item.count ? <div className="analysis-performance-turns">{item.turns.map((turn, index) => <span className="analysis-performance-turn" key={`${turn.id}-${index}`} title={turn.id}><strong>{turnRoleLabel(turn.role)}</strong><span>{turn.preview || 'Response summary not included in this analysis version.'}</span></span>)}</div> : <em>No turns have this label</em>}</div>)}</div> : <p className="analysis-empty-copy">This analysis did not store a turn-effect label.</p>}</div>
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
  return <div className="analysis-filter-panel"><div className="analysis-filter-controls"><label>Evidence type<select aria-label="Evidence type" value={evidenceType} onChange={(event) => onEvidenceTypeChange(event.target.value)}>{EVIDENCE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Decision or label<select aria-label="Decision or label" value={decisionFilter} disabled={evidenceType === 'capture_gaps'} onChange={(event) => onDecisionChange(event.target.value)}>{DECISION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{filtersActive && <button type="button" className="analysis-filter-clear" onClick={onClear}>Clear filters</button>}</div><p className="analysis-filter-summary">Showing {visibleCount.toLocaleString()} of {eligibleCount.toLocaleString()} saved records</p></div>
}

function CaptureGaps({ annotation, visible }) {
  if (!visible) return null
  const gaps = annotation.captureGaps
  const availability = !annotation.captureGapsRecorded
    ? annotation.schemaVersion === '1' ? 'Capture gaps are not represented by schema v1.' : 'Capture-gap records were not included in this analysis.'
    : gaps.length ? `${gaps.length.toLocaleString()} evidence limitations recorded.` : 'No capture gaps were recorded.'

  return <section className="analysis-capture-gaps" aria-labelledby="capture-gaps-title"><div className="analysis-subsection-heading"><div><span className="section-label">Evidence limitations</span><h4 id="capture-gaps-title">Capture gaps</h4></div><strong>{annotation.captureGapsRecorded ? `${gaps.length.toLocaleString()} recorded` : 'Not included'}</strong></div><p className="analysis-empty-copy">{availability}</p>{gaps.length > 0 && <ol className="analysis-capture-gap-list">{gaps.map((gap, index) => <li className="analysis-capture-gap" key={`${gap.category}-${index}`}><div className="analysis-evidence-record-heading"><strong>{gap.category}</strong></div><div className="analysis-evidence-context"><span>Limitation</span><p>{gap.summary || 'No limitation summary was saved.'}</p></div><div className="analysis-evidence-context"><span>Impact</span><p>{gap.impact || 'Impact was not recorded.'}</p></div>{gap.eventIds.length > 0 && <div className="analysis-evidence-context"><span>Affected event IDs</span><ul className="analysis-related-events">{gap.eventIds.map((eventId) => <li key={eventId}><code>{eventId}</code></li>)}</ul></div>}</li>)}</ol>}</section>
}

function AnnotationPanel({ annotation }) {
  const [evidenceType, setEvidenceType] = useState(ALL_FILTER)
  const [decisionFilter, setDecisionFilter] = useState(ALL_FILTER)

  if (!annotation.recorded) {
    return <section className="analysis-block annotation-block" aria-labelledby="annotation-title"><div className="analysis-block-heading"><div><span className="section-label">Annotation</span><h3 id="annotation-title">Reviewed evidence</h3><p>This analysis response contains no saved annotation.</p></div><StatusPill tone="unknown">Not recorded</StatusPill></div><div className="analysis-inline-empty"><strong>Annotation not recorded</strong><span>No user-turn, agent-turn, tool, skill, or file labels were saved for this session.</span></div></section>
  }

  const filteredCategories = annotation.categories
    .filter(() => evidenceType !== 'capture_gaps')
    .filter((category) => evidenceType === ALL_FILTER || category.key === evidenceType)
    .filter((category) => categorySupportsDecision(category, decisionFilter))
    .map((category) => filteredCategory(category, evidenceType, decisionFilter))
  const showCaptureGaps = decisionFilter === ALL_FILTER && (evidenceType === ALL_FILTER || evidenceType === 'capture_gaps')
  const eligibleCount = filteredCategories.reduce((total, item) => total + item.category.annotatedCount, 0)
    + (showCaptureGaps && annotation.captureGapsRecorded ? annotation.captureGaps.length : 0)
  const visibleCount = filteredCategories.reduce((total, item) => total + item.visibleRecords.length, 0)
    + (showCaptureGaps ? annotation.captureGaps.length : 0)
  const filtersActive = evidenceType !== ALL_FILTER || decisionFilter !== ALL_FILTER

  return <section className="analysis-block annotation-block" aria-labelledby="annotation-title"><div className="analysis-block-heading"><div><span className="section-label">Annotation</span><h3 id="annotation-title">Reviewed evidence</h3><p>Counts describe saved labels. V2 records include every captured item per category. Unclear counts are records with at least one unclear decision.</p></div><StatusPill tone="positive">Saved</StatusPill></div><AnnotationFilters evidenceType={evidenceType} decisionFilter={decisionFilter} onEvidenceTypeChange={(value) => { setEvidenceType(value); if (value === 'capture_gaps') setDecisionFilter(ALL_FILTER) }} onDecisionChange={setDecisionFilter} onClear={() => { setEvidenceType(ALL_FILTER); setDecisionFilter(ALL_FILTER) }} visibleCount={visibleCount} eligibleCount={eligibleCount} /><PerformanceSummary annotation={annotation} /><CaptureGaps annotation={annotation} visible={showCaptureGaps} /><div className="analysis-category-list">{filteredCategories.map(({ category, visibleRecords, visibleBreakdowns }) => <AnnotationCategory key={category.key} category={category} visibleRecords={visibleRecords} visibleBreakdowns={visibleBreakdowns} filtersActive={filtersActive} />)}</div></section>
}

function SignalOccurrence({ occurrence, index }) {
  return <li className="analysis-signal-occurrence"><span className="analysis-signal-occurrence-index">{index + 1}</span><div><div className="analysis-signal-occurrence-heading"><strong>{occurrence.eventKind || 'Captured occurrence'}</strong><code>event id: {occurrence.eventId}</code></div>{occurrence.occurredAt && <time dateTime={occurrence.occurredAt}>{occurrence.occurredAt}</time>}<div className="analysis-signal-occurrence-input"><span>What happened</span><p>{occurrence.summary || 'The saved occurrence has no summary.'}</p></div><div className="analysis-signal-occurrence-input"><span>Why it matters</span><p>{occurrence.impact || 'Impact was not recorded.'}</p></div></div></li>
}

function signalOccurrenceSummary(signal) {
  const available = signal.occurrences?.length || 0
  const total = signal.count
  if (total == null) return { headline: `${available.toLocaleString()} located occurrences`, detail: available ? 'The evaluator did not record a separate total.' : 'This result contains no event-level occurrence records.' }
  if (!available) return { headline: 'No event locations saved', detail: `${total.toLocaleString()} occurrences were recorded as a count only. This result does not contain the event IDs or summaries needed to locate them.` }
  const missing = Math.max(total - available, 0)
  return { headline: `${available.toLocaleString()} located of ${total.toLocaleString()} recorded`, detail: missing ? `${missing.toLocaleString()} more are included in the count but have no saved occurrence detail.` : 'Each listed row comes from an explicit occurrence in the saved evaluation.' }
}

function ReviewSignals({ signals }) {
  const [severityFilter, setSeverityFilter] = useState(ALL_FILTER)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filteredSignals = signals.filter((signal) => {
    if (severityFilter !== ALL_FILTER && signal.severity !== severityFilter) return false
    if (!normalizedQuery) return true
    return [signal.name, signal.detail, ...signal.occurrences.flatMap((occurrence) => [occurrence.eventId, occurrence.eventKind, occurrence.summary, occurrence.impact])]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalizedQuery))
  })
  const filtersActive = severityFilter !== ALL_FILTER || Boolean(normalizedQuery)
  const clearFilters = () => { setSeverityFilter(ALL_FILTER); setQuery('') }

  return <div className="analysis-subsection"><div className="analysis-subsection-heading"><span>Review signals</span><strong>{signals.length ? `${signals.length} recorded findings` : 'Not recorded'}</strong></div>{signals.length ? <><p className="analysis-signal-legend">Warning and critical labels need review. Info labels provide context. Each listed occurrence is an explicit saved event, not an example parsed from the description.</p><div className="analysis-signal-filters"><label>Severity<select aria-label="Signal severity" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option value={ALL_FILTER}>All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option><option value="unknown">Unknown</option></select></label><label>Find a signal or event<input aria-label="Find a signal or event" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, event ID, or evidence text" /></label>{filtersActive && <button type="button" className="analysis-filter-clear" onClick={clearFilters}>Clear filters</button>}</div><p className="analysis-filter-summary" aria-live="polite">Showing {filteredSignals.length} of {signals.length} findings</p>{filteredSignals.length ? <ul className="analysis-signal-list">{filteredSignals.map((signal, index) => { const summary = signalOccurrenceSummary(signal); const severityLabel = signal.severity.charAt(0).toUpperCase() + signal.severity.slice(1); return <li className={`analysis-signal-row ${signal.severity}`} key={`${signal.name}-${index}`}><div className="analysis-signal-body"><strong>{signal.name}</strong><span>{signal.detail}</span><em>{signal.severityMeaning}</em><details className="analysis-signal-details" open><summary><strong>Occurrence details</strong><span>{summary.headline}</span></summary><div className="analysis-signal-occurrences">{summary.detail && <p className="analysis-signal-occurrences-note">{summary.detail}</p>}{signal.occurrences.length ? <ol>{signal.occurrences.map((occurrence, occurrenceIndex) => <SignalOccurrence key={`${occurrence.eventId}-${occurrenceIndex}`} occurrence={occurrence} index={occurrenceIndex} />)}</ol> : <p className="analysis-empty-copy">The saved result has no individual occurrence rows. Its description is shown above as written.</p>}</div></details></div><StatusPill tone={signal.severity}>{signal.count == null ? 'Count not recorded' : `${signal.count.toLocaleString()} ${signal.count === 1 ? 'occurrence' : 'occurrences'} · ${severityLabel}`}</StatusPill></li> })}</ul> : <p className="analysis-empty-copy">No findings match these filters.</p>}</> : <p className="analysis-empty-copy">No review signals were saved in this evaluation.</p>}</div>
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
  const actionCount = evaluation.followUps.length + evaluation.evaluationLedger.improvements.length

  return <section className={`analysis-overview ${evaluation.verdict}`} aria-labelledby="analysis-overview-title"><div className="analysis-overview-readout"><span className="section-label">Evaluation summary</span><h3 id="analysis-overview-title">Review at a glance</h3><strong className="analysis-overview-verdict">{overviewReadout(evaluation.verdict)}</strong><p>{evaluation.critique || 'No written critique was recorded.'}</p></div><div className="analysis-overview-stats"><div><span>Outcome</span><strong>{evaluation.verdictLabel}</strong><small>evaluator result</small></div><div><span>Findings</span><strong>{concernValue}</strong><small>{concernDetail}</small></div><div><span>Agent next steps</span><strong>{actionCount ? actionCount.toLocaleString() : 'None'}</strong><small>{actionCount ? 'recorded changes and finding-based follow-ups' : 'no action was recorded'}</small></div><div><span>Agent turns reviewed</span><strong>{coverage.value}</strong><small>{coverage.detail}</small></div></div></section>
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

  return <details className="analysis-evidence-disclosure" open><summary><span className="analysis-disclosure-summary-copy"><span className="section-label">Audit trail</span><strong>Evidence details</strong><span>Saved turns, tool calls, skills, files, signals, and judge comparison.</span></span><span className="analysis-disclosure-summary-meta">{evidenceSummary}<span className="analysis-disclosure-toggle">Collapse evidence</span></span></summary><div className="analysis-disclosure-content"><AnnotationPanel annotation={annotation} /><EvaluationPanel evaluation={evaluation} /></div></details>
}

function ImprovementActions({ ledger, followUps = [] }) {
  const improvements = ledger?.improvements || []
  const legacyImprovements = ledger?.legacyImprovements || []
  const hasActions = improvements.length > 0
  const hasLegacyActions = legacyImprovements.length > 0
  const hasFollowUps = followUps.length > 0
  const recordedLabel = `${improvements.length.toLocaleString()} valid agent ${improvements.length === 1 ? 'action' : 'actions'}`
  const followUpLabel = `${followUps.length.toLocaleString()} ${followUps.length === 1 ? 'follow-up' : 'follow-ups'} from warning findings`
  const followUpStatusLabel = `${followUps.length.toLocaleString()} ${followUps.length === 1 ? 'follow-up' : 'follow-ups'}`
  const legacyLabel = `${legacyImprovements.length.toLocaleString()} legacy ${legacyImprovements.length === 1 ? 'target' : 'targets'} excluded`
  const statusLabel = [hasActions && `${improvements.length.toLocaleString()} valid`, hasFollowUps && followUpStatusLabel, hasLegacyActions && legacyLabel].filter(Boolean).join(' · ')

  return <section className={`analysis-block analysis-actions-block ${hasActions || hasFollowUps ? 'has-actions' : 'is-empty'}`} aria-labelledby="analysis-actions-title"><div className="analysis-block-heading"><div><span className="section-label">Action plan</span><h3 id="analysis-actions-title">What to improve</h3><p>Every action targets agent behavior or agent instruction Markdown. The project name is context only.</p></div><StatusPill tone={hasActions || hasFollowUps ? 'positive' : hasLegacyActions ? 'warning' : 'unknown'}>{statusLabel || 'No actions recorded'}</StatusPill></div>{ledger?.project && <div className="analysis-ledger-context"><span>Project context</span><strong>{ledger.project}</strong><p>This is the evaluated project, not an improvement target.</p></div>}{hasActions && <div className="analysis-actions-group"><div className="analysis-actions-group-heading"><strong>Evaluator-recorded changes</strong><span>{recordedLabel}</span></div><ol className="analysis-actions-list">{improvements.map((improvement, index) => <li key={`${improvement.target}-${index}`}><div className="analysis-action-field"><span>Change</span><strong>{improvement.change}</strong></div><div className="analysis-action-field"><span>Target</span><strong>{improvement.targetLabel}</strong>{improvement.path && <code>{improvement.path}</code>}</div><div className="analysis-action-field"><span>Why</span><p>{improvement.reason}</p></div><ActionEvidence eventIds={improvement.evidenceEventIds} /></li>)}</ol></div>}{hasFollowUps && <div className="analysis-actions-group analysis-derived-actions"><div className="analysis-actions-group-heading"><strong>Next steps from findings</strong><span>{followUpLabel}</span></div><ol className="analysis-actions-list">{followUps.map((followUp, index) => <li key={`${followUp.signalKey}-${index}`}><div className="analysis-action-field"><span>Finding</span><strong>{followUp.title}</strong></div><div className="analysis-action-field"><span>Next step for the agent</span><strong>{followUp.action}</strong></div><div className="analysis-action-field"><span>Why this is here</span><p>{followUp.reason}</p></div><div className="analysis-action-field"><span>Target</span><strong>{followUp.targetLabel}</strong></div>{followUp.occurrenceCount != null && <div className="analysis-action-field"><span>Recorded occurrences</span><span>{followUp.occurrenceCount.toLocaleString()}</span></div>}<ActionEvidence eventIds={followUp.evidenceEventIds} /><span className="analysis-action-source">Suggested from a saved warning or critical finding</span></li>)}</ol></div>}{hasLegacyActions && <div className="analysis-actions-group analysis-derived-actions analysis-legacy-actions"><div className="analysis-actions-group-heading"><strong>Older out-of-scope targets</strong><span>{legacyLabel}</span></div><p className="analysis-action-legacy-note">These older records point to project source. They remain visible for context but are excluded from the agent action plan.</p><ol className="analysis-actions-list">{legacyImprovements.map((improvement, index) => <li key={`${improvement.target}-${index}`}><div className="analysis-action-field"><span>Target</span><strong>{improvement.targetLabel}</strong>{improvement.path && <code>{improvement.path}</code>}</div><div className="analysis-action-field"><span>Status</span><strong>Excluded from agent improvements</strong></div><div className="analysis-action-field"><span>Recorded change</span><strong>{improvement.change}</strong></div><div className="analysis-action-field"><span>Why excluded</span><p>{improvement.outOfScopeReason}</p></div><ActionEvidence eventIds={improvement.evidenceEventIds} /></li>)}</ol></div>}{!hasActions && !hasFollowUps && !hasLegacyActions && <div className="analysis-inline-empty"><strong>No improvement actions recorded</strong><span>This evaluation did not save a concrete agent behavior or instruction change.</span></div>}{!hasActions && !hasFollowUps && hasLegacyActions && <div className="analysis-inline-empty"><strong>No agent improvement actions recorded</strong><span>The saved evaluation contains only older targets outside the agent and instruction Markdown scope.</span></div>}</section>
}

function ActionEvidence({ eventIds }) {
  return <div className="analysis-action-field"><span>Evidence</span>{eventIds.length ? <ul className="analysis-related-events">{eventIds.map((eventId) => <li key={eventId}><code>{eventId}</code></li>)}</ul> : <p>Event-level evidence IDs were not stored for this action.</p>}</div>
}

function EvaluationPanel({ evaluation }) {
  return <section className="analysis-block evaluation-block" aria-labelledby="evaluation-title"><div className="analysis-block-heading"><div><span className="section-label">Evaluation result</span><h3 id="evaluation-title">Findings and comparison</h3><p>Open this section when you need the signal details or judge comparison behind the summary.</p></div><StatusPill tone={evaluation.verdict === 'pass' ? 'positive' : evaluation.verdict === 'fail' ? 'critical' : 'unknown'}>{evaluation.verdictLabel}</StatusPill></div>{evaluation.recorded ? <><ReviewSignals signals={evaluation.reviewSignals} /><JudgeAlignment alignment={evaluation.judgeAlignment} /></> : <div className="analysis-inline-empty"><strong>Evaluation not recorded</strong><span>No verdict, critique, review signals, or judge comparison were stored for this session.</span></div>}</section>
}

function NoAnalysisState() {
  return <div className="analysis-empty-state" role="status"><strong>No analysis saved</strong><p>The analysis endpoint returned no annotation or evaluation for this session.</p><div className="analysis-not-recorded-grid"><div><span>Annotation</span><strong>Not recorded</strong></div><div><span>Evaluation</span><strong>Not recorded</strong></div></div></div>
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
  return <aside className={`insights-section analysis-insights analysis-full-page ${analysis.recorded ? '' : 'is-unrecorded'}`} aria-labelledby="analysis-details-title"><div className="section-heading-row analysis-heading"><div><p className="section-label">Evaluation review</p><h2 id="analysis-details-title">Review details</h2><p className="section-description">Outcome and agent next steps appear first. Evidence records stay open below.</p></div><StatusPill tone={analysis.recorded ? 'positive' : 'unknown'}>{analysis.recorded ? 'Recorded' : 'Not recorded'}</StatusPill></div>{analysis.recorded ? <div className="analysis-content">{analysis.evaluation.recorded && <EvaluationOverview analysis={analysis} />}{analysis.evaluation.recorded && <ImprovementActions ledger={analysis.evaluation.evaluationLedger} followUps={analysis.evaluation.followUps} />}{analysis.evaluation.recorded ? <EvidenceDisclosure annotation={analysis.annotation} evaluation={analysis.evaluation} /> : <><AnnotationPanel annotation={analysis.annotation} /><EvaluationPanel evaluation={analysis.evaluation} /></>}</div> : <NoAnalysisState />}</aside>
}

export default function InsightCards({ analysis, trace, insights, compact = false, sessionId, forceAnalysis = false }) {
  const isApiTrace = analysis !== undefined || Boolean(trace && (trace.schema_version || trace.conversation || trace.timeline))
  if (!isApiTrace && !forceAnalysis) return <LegacyInsightCards insights={insights} />
  return <AnalysisCards analysis={normalizeSessionAnalysis(analysis, trace)} compact={compact} sessionId={sessionId} />
}
