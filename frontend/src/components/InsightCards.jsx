import { useId, useState } from 'react'
import { normalizeSessionAnalysis, repairCapturedText } from '../sessionAnalysis'

const TONE_CLASSES = ['green', 'purple', 'amber']
const ALL_FILTER = 'all'
const INITIAL_LIST_SIZE = 8
const LOAD_MORE_SIZE = 8
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

function BoundedList({ items, itemLabel, resetKey = '', ordered = false, className, renderItem }) {
  const listId = useId()
  const [page, setPage] = useState({ key: resetKey, count: INITIAL_LIST_SIZE })
  const visibleCount = Math.min(items.length, page.key === resetKey ? page.count : INITIAL_LIST_SIZE)
  const visibleItems = items.slice(0, visibleCount)
  const List = ordered ? 'ol' : 'ul'
  const loadMore = () => setPage((current) => ({
    key: resetKey,
    count: Math.min(items.length, (current.key === resetKey ? current.count : INITIAL_LIST_SIZE) + LOAD_MORE_SIZE),
  }))
  const showFewer = () => setPage({ key: resetKey, count: INITIAL_LIST_SIZE })

  return <>
    <List id={listId} className={className}>{visibleItems.map(renderItem)}</List>
    {items.length > INITIAL_LIST_SIZE && <div className="analysis-list-pagination">
      <span role="status" aria-live="polite">Showing {visibleCount.toLocaleString()} of {items.length.toLocaleString()} {itemLabel}</span>
      {visibleCount < items.length
        ? <button type="button" aria-controls={listId} onClick={loadMore}>Load more {itemLabel}</button>
        : <button type="button" aria-controls={listId} onClick={showFewer}>Show fewer {itemLabel}</button>}
    </div>}
  </>
}

function annotationStatus(category) {
  return category.recorded && category.recordCount ? 'positive' : 'unknown'
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

function EvidenceRecord({ category, record, eventContextLookup }) {
  const context = eventContextForRecord(category, record)

  if (category.key === 'user_turns') {
    return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{record.signalType}</strong></div><EventEvidence eventId={record.eventId} eventContextLookup={eventContextLookup} contextFallback={context} />{record.turnId && <CopyableReference value={record.turnId} label="Turn ID" referenceType="turn ID" />}{record.rationale && <div className="analysis-evidence-context"><span>Why this message was classified this way</span><p>{record.rationale}</p></div>}{record.relatedEventIds.length > 0 && <RelatedEvents eventIds={record.relatedEventIds} eventContextLookup={eventContextLookup} />}</li>
  }

  if (category.key === 'turns') {
    const rationaleLabel = record.rationale ? 'Why this label was applied' : 'Rationale status'
    const rationale = record.rationale || (record.performance === 'neutral'
      ? 'Unclear — no evidence-based rationale was saved for this neutral label.'
      : 'Rationale not recorded for this saved label.')

    return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{turnRoleLabel(record.turnRole)}</strong></div><EventEvidence eventId={record.eventId} eventContextLookup={eventContextLookup} contextFallback={context} />{record.turnId && <CopyableReference value={record.turnId} label="Turn ID" referenceType="turn ID" />}<div className="analysis-evidence-tags"><StatusPill tone={record.followsInstructions === 'no' ? 'critical' : record.followsInstructions === 'yes' ? 'positive' : 'unknown'}>Instruction adherence: {decisionLabel('followsInstructions', record.followsInstructions)}</StatusPill>{record.scopeAdherence && <StatusPill tone={record.scopeAdherence === 'deviation' ? 'critical' : record.scopeAdherence === 'within_scope' ? 'positive' : 'unknown'}>Scope: {humanLabel(record.scopeAdherence)}</StatusPill>}{record.groundedness && <StatusPill tone={record.groundedness === 'unsupported' ? 'critical' : record.groundedness === 'supported' ? 'positive' : 'unknown'}>Claims: {humanLabel(record.groundedness)}</StatusPill>}{record.verification && <StatusPill tone={record.verification === 'not_verified' ? 'warning' : record.verification === 'verified' ? 'positive' : 'unknown'}>Verification: {humanLabel(record.verification)}</StatusPill>}{record.performance && <StatusPill tone={record.performance === 'worsened' ? 'critical' : record.performance === 'improved' ? 'positive' : 'unknown'}>Effect on result: {decisionLabel('performance', record.performance)}</StatusPill>}</div><div className="analysis-evidence-context"><span>{rationaleLabel}</span><p>{rationale}</p></div>{record.relatedEventIds.length > 0 && <RelatedEvents eventIds={record.relatedEventIds} eventContextLookup={eventContextLookup} />}</li>
  }

  if (category.key === 'files') {
    return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{record.operation}</strong></div><EventEvidence eventId={record.eventId} eventContextLookup={eventContextLookup} contextFallback={context} />{record.necessary && <StatusPill tone={record.necessary === 'no' ? 'critical' : record.necessary === 'yes' ? 'positive' : 'unknown'}>Relevance: {decisionLabel('necessary', record.necessary)}</StatusPill>}{record.rationale && <div className="analysis-evidence-context"><span>Why this label was applied</span><p>{record.rationale}</p></div>}</li>
  }

  const label = category.key === 'skills' ? record.skillName : record.toolName || 'Tool name not recorded'
  return <li className="analysis-evidence-record"><div className="analysis-evidence-record-heading"><strong>{label}</strong></div><EventEvidence eventId={record.eventId} eventContextLookup={eventContextLookup} contextFallback={context} />{record.toolUseId && <CopyableReference value={record.toolUseId} label="Tool use ID" referenceType="tool use ID" />}<div className="analysis-evidence-tags"><StatusPill tone={record.necessary === 'no' ? 'critical' : record.necessary === 'yes' ? 'positive' : 'unknown'}>Needed for task: {decisionLabel('necessary', record.necessary)}</StatusPill></div>{record.rationale && <div className="analysis-evidence-context"><span>Why this label was applied</span><p>{record.rationale}</p></div>}</li>
}

function humanLabel(value) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function savedDetail(label, value) {
  return typeof value === 'string' && value.trim() ? { label, value } : null
}

function eventContextForRecord(category, record) {
  if (category.key === 'user_turns') {
    return {
      label: `User prompt · ${record.signalType}`,
      details: [savedDetail('What the user said', record.summary)].filter(Boolean),
    }
  }
  if (category.key === 'turns') {
    return {
      label: turnRoleLabel(record.turnRole),
      details: [savedDetail('Captured response', record.responseSummary)].filter(Boolean),
    }
  }
  if (category.key === 'tools') {
    return {
      label: `Tool call · ${record.toolName || 'Tool name not recorded'}`,
      details: [
        savedDetail(record.inputPreviewLabel || 'Command or input', record.inputPreview),
        savedDetail('Tool result', record.outputSummary || 'Summary not included in this analysis version.'),
        savedDetail('Completion evidence', record.completionDetail),
      ].filter(Boolean),
    }
  }
  if (category.key === 'skills') {
    return {
      label: `Skill invocation · ${record.skillName}`,
      details: [savedDetail('Skill use', record.summary)].filter(Boolean),
    }
  }
  if (category.key === 'files') {
    return {
      label: `File operation · ${record.operation}`,
      details: [
        record.path !== 'File path not recorded' && savedDetail('File path', record.path),
        savedDetail('What happened', record.summary),
      ].filter(Boolean),
    }
  }
  return null
}

function traceValue(value) {
  if (typeof value === 'string') return value.trim() || null
  if (value == null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function tracePreview(value) {
  const text = repairCapturedText(traceValue(value)?.replace(/\s+/g, ' ').trim() || '')
  if (!text) return null
  return text.length > 1000 ? `${text.slice(0, 1000).trimEnd()}…` : text
}

function firstTraceValue(record, keys) {
  for (const key of keys) {
    const value = tracePreview(record?.[key])
    if (value) return value
  }
  return null
}

function traceEventId(record) {
  return record?.event_id ?? record?.eventId ?? record?.id ?? null
}

function traceToolContext(toolCall, event = {}) {
  const toolName = firstTraceValue(toolCall, ['tool_name', 'toolName', 'name']) || 'Tool name not recorded'
  const lifecycle = firstTraceValue(event, ['hook_event_name', 'hookEventName', 'event_kind', 'eventKind', 'event_name', 'eventName', 'type'])
  const status = firstTraceValue(toolCall, ['completion_status', 'completionStatus', 'status', 'tool_status'])
  return {
    label: `Captured tool call · ${toolName}`,
    occurredAt: firstTraceValue(event, ['occurred_at', 'occurredAt', 'timestamp']) || firstTraceValue(toolCall, ['occurred_at', 'occurredAt', 'timestamp']),
    details: [
      savedDetail('Lifecycle event', lifecycle),
      savedDetail('Command or input', firstTraceValue(toolCall, ['input', 'tool_input', 'toolInput', 'arguments', 'command'])),
      savedDetail('Tool output', firstTraceValue(toolCall, ['output', 'tool_output', 'toolOutput', 'result', 'response', 'content'])),
      savedDetail('Completion status', status),
    ].filter(Boolean),
  }
}

function addCapturedTraceContexts(trace, addContext) {
  const conversation = Array.isArray(trace?.conversation) ? trace.conversation : []
  conversation.forEach((item) => {
    const role = String(item?.role || '').toLowerCase()
    addContext(traceEventId(item), {
      label: role === 'user' ? 'Captured user message' : role === 'assistant' ? 'Captured assistant response' : 'Captured conversation event',
      occurredAt: firstTraceValue(item, ['occurred_at', 'occurredAt', 'timestamp']),
      details: [savedDetail(role === 'user' ? 'What the user said' : 'Captured message', tracePreview(item?.content ?? item?.message))].filter(Boolean),
    })
  })

  const timeline = Array.isArray(trace?.timeline) ? trace.timeline : []
  const toolCalls = Array.isArray(trace?.tool_calls) ? trace.tool_calls : []
  timeline.forEach((event) => {
    const indexValue = event?.tool_call_index ?? event?.toolCallIndex
    const toolUseId = event?.tool_use_id ?? event?.toolUseId
    const hasCallIndex = indexValue !== null && indexValue !== undefined && indexValue !== '' && Number.isInteger(Number(indexValue))
    const toolCall = hasCallIndex
      ? toolCalls[Number(indexValue)]
      : toolCalls.find((call) => toolUseId && (call?.tool_use_id ?? call?.toolUseId) === toolUseId)
    const eventId = traceEventId(event)
    if (!eventId) return
    if (toolCall) {
      addContext(eventId, traceToolContext(toolCall, event))
      return
    }
    const lifecycle = firstTraceValue(event, ['hook_event_name', 'hookEventName', 'event_kind', 'eventKind', 'event_name', 'eventName', 'type'])
    addContext(eventId, {
      label: lifecycle ? `Captured trace event · ${lifecycle}` : 'Captured trace event',
      occurredAt: firstTraceValue(event, ['occurred_at', 'occurredAt', 'timestamp']),
      details: [savedDetail('Captured content', firstTraceValue(event, ['content', 'message', 'summary']))].filter(Boolean),
    })
  })

  toolCalls.forEach((toolCall) => {
    const eventId = traceEventId(toolCall)
    if (eventId) addContext(eventId, traceToolContext(toolCall))
  })

  const skills = Array.isArray(trace?.skill_invocations)
    ? trace.skill_invocations
    : Array.isArray(trace?.skillInvocations) ? trace.skillInvocations : []
  skills.forEach((skill) => {
    const eventId = traceEventId(skill)
    if (!eventId) return
    const name = firstTraceValue(skill, ['skill_name', 'skillName', 'name']) || 'Skill name not recorded'
    addContext(eventId, {
      label: `Captured skill invocation · ${name}`,
      occurredAt: firstTraceValue(skill, ['occurred_at', 'occurredAt', 'timestamp']),
      details: [savedDetail('Invocation details', firstTraceValue(skill, ['summary', 'detail', 'confidence']))].filter(Boolean),
    })
  })

  const files = Array.isArray(trace?.files)
    ? trace.files
    : Array.isArray(trace?.fileOperations) ? trace.fileOperations : []
  files.forEach((file) => {
    const eventId = traceEventId(file)
    if (!eventId) return
    const operation = firstTraceValue(file, ['operation', 'action']) || 'Operation not recorded'
    addContext(eventId, {
      label: `Captured file operation · ${operation}`,
      occurredAt: firstTraceValue(file, ['occurred_at', 'occurredAt', 'timestamp']),
      details: [
        savedDetail('File path', firstTraceValue(file, ['path', 'file_path', 'filePath'])),
        savedDetail('What happened', firstTraceValue(file, ['summary', 'detail'])),
      ].filter(Boolean),
    })
  })
}

function createEventContextLookup(annotation, evaluation, trace) {
  const contextsByEventId = new Map()
  const addContext = (eventId, context) => {
    if (!eventId || eventId === 'Event ID not recorded' || !context) return
    const contexts = contextsByEventId.get(eventId) || []
    const signature = JSON.stringify([context.label, context.occurredAt || null, context.details])
    if (!contexts.some((item) => item.signature === signature)) contexts.push({ ...context, signature })
    contextsByEventId.set(eventId, contexts)
  }

  annotation.categories.forEach((category) => {
    category.records.forEach((record) => addContext(record.eventId, eventContextForRecord(category, record)))
  })
  annotation.captureGaps.forEach((gap) => {
    gap.eventIds.forEach((eventId) => addContext(eventId, {
      label: `Capture gap · ${gap.category}`,
      details: [savedDetail('Limitation', gap.summary), savedDetail('Impact', gap.impact)].filter(Boolean),
    }))
  })
  evaluation.reviewSignals.forEach((signal) => {
    signal.occurrences.forEach((occurrence) => addContext(occurrence.eventId, {
      label: signal.name || 'Review signal occurrence',
      occurredAt: occurrence.occurredAt,
      details: [savedDetail('Lifecycle event', occurrence.eventKind), savedDetail('What happened', occurrence.summary), savedDetail('Why it matters', occurrence.impact)].filter(Boolean),
    }))
  })

  addCapturedTraceContexts(trace, addContext)

  return contextsByEventId
}

function EventContextCard({ context }) {
  return <div className="analysis-evidence-context analysis-linked-event-context"><span>{context.label}</span>{context.occurredAt && <time dateTime={context.occurredAt}>{context.occurredAt}</time>}{context.details.length ? context.details.map((detail) => <div className="analysis-linked-event-detail" key={`${detail.label}-${detail.value}`}><span>{detail.label}</span><p>{detail.value}</p></div>) : <p>No readable summary was saved for this event.</p>}</div>
}

function CopyableReference({ value, label, referenceType }) {
  const [copyStatus, setCopyStatus] = useState('')

  const copyReference = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setCopyStatus('Clipboard unavailable; select the ID to copy.')
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      setCopyStatus('Copied')
    } catch {
      setCopyStatus('Copy failed; select the ID to copy.')
    }
  }

  return <span className="analysis-event-reference"><span className="analysis-event-reference-label">{label}</span><code>{value}</code><button type="button" className="analysis-copy-event-id" aria-label={`Copy ${referenceType} ${value}`} onClick={copyReference}>Copy ID</button><span className="analysis-copy-event-status" role="status" aria-live="polite">{copyStatus}</span></span>
}

function CopyableEventId({ eventId, label = 'Event ID', referenceType = 'event ID' }) {
  return <CopyableReference value={eventId} label={label} referenceType={referenceType} />
}

function EventEvidence({ eventId, eventContextLookup, contextFallback, referenceLabel = 'Event ID', referenceType = 'event ID' }) {
  const isRecordedEventId = Boolean(eventId && eventId !== 'Event ID not recorded')
  const contexts = eventContextLookup.get(eventId) || []
  const visibleContexts = contexts.length ? contexts : contextFallback ? [contextFallback] : []

  return <div className="analysis-event-evidence">{visibleContexts.length ? visibleContexts.map((context, index) => <EventContextCard context={context} key={context.signature || `${context.label}-${index}`} />) : <div className="analysis-evidence-context analysis-linked-event-context"><span>Context unavailable</span><p>No matching saved event context was found for this reference.</p></div>}{isRecordedEventId ? <CopyableEventId eventId={eventId} label={referenceLabel} referenceType={referenceType} /> : <span className="analysis-event-id-missing">Event ID not recorded.</span>}</div>
}

function EventEvidenceRow({ eventId, eventContextLookup, referenceLabel = 'Related event ID', referenceType = referenceLabel }) {
  return <li className="analysis-related-event"><EventEvidence eventId={eventId} eventContextLookup={eventContextLookup} referenceLabel={referenceLabel} referenceType={referenceType} /></li>
}

function RelatedEvents({ eventIds, eventContextLookup, label = 'Related captured events' }) {
  return <div className="analysis-evidence-context">
    <span>{label}</span>
    <BoundedList items={eventIds} itemLabel="related event references" resetKey={eventIds.length} className="analysis-related-events" renderItem={(eventId, index) => <EventEvidenceRow key={eventId + '-' + index} eventId={eventId} eventContextLookup={eventContextLookup} />} />
  </div>
}

function Breakdown({ breakdowns }) {
  return <div className="analysis-breakdown">{breakdowns.map((breakdown) => <div className="analysis-breakdown-row" key={breakdown.label}><span>{breakdown.label}</span><div>{breakdown.values.map(({ value, count }) => <span className="analysis-breakdown-value" key={value}><strong>{count}</strong> {evidenceValue(value)}</span>)}</div></div>)}</div>
}

function AnnotationCategory({ category, visibleRecords, visibleBreakdowns, filtersActive, eventContextLookup, filterKey }) {
  const unlabeledCount = category.capturedCount == null || category.labeledCount == null ? null : Math.max(category.capturedCount - category.labeledCount, 0)
  const coverageDetail = unlabeledCount === null
    ? category.coverageDetail
    : `${category.coverageDetail}${unlabeledCount ? ` · ${unlabeledCount.toLocaleString()} not labeled` : ''}`
  const stateLabel = !category.recorded ? 'Not included in this analysis' : category.recordCount ? 'Evidence recorded' : 'No records saved'

  return <details className="analysis-category-card">
    <summary className="analysis-category-summary">
      <div className="analysis-category-header">
        <div>
          <span className="analysis-card-kicker">{category.label}</span>
          <strong>{category.recordCount.toLocaleString()} saved {category.recordCount === 1 ? 'record' : 'records'}</strong>
          <small>Coverage: {category.recorded ? category.coverageValue : category.unavailableDetail || category.coverageValue}</small>
          {category.recorded && <small>{coverageDetail}</small>}
          {category.recorded && <small className="analysis-coverage-source">Coverage source: {category.coverageSource}</small>}
          {category.recorded && <small className="analysis-category-unclear">{category.unclearCount ? `${category.unclearCount.toLocaleString()} ${category.unclearCount === 1 ? 'record has' : 'records have'} one or more unclear decisions.` : 'No records have an unclear decision.'}</small>}
        </div>
        <div className="analysis-category-summary-side">
          <StatusPill tone={annotationStatus(category)}>{stateLabel}</StatusPill>
          <span className="analysis-disclosure-hint">Open records</span>
        </div>
      </div>
    </summary>
    <div className="analysis-category-content">
      {category.recorded && <Breakdown breakdowns={visibleBreakdowns} />}
      {category.recorded && <div className="analysis-evidence-heading">
        <span>Saved evidence in this category</span>
        <strong>{filtersActive ? `${visibleRecords.length.toLocaleString()} matching / ${category.recordCount.toLocaleString()} saved records` : `${category.recordCount.toLocaleString()} saved records`}</strong>
      </div>}
      {visibleRecords.length
        ? <BoundedList items={visibleRecords} itemLabel="evidence records" resetKey={filterKey} className="analysis-evidence-list" renderItem={(record, index) => <EvidenceRecord category={category} record={record} eventContextLookup={eventContextLookup} key={record.eventId + '-' + index} />} />
        : <p className="analysis-empty-copy">{!category.recorded ? category.unavailableDetail || 'This category was not stored in the saved analysis.' : filtersActive ? 'No records match the current filters.' : `No ${category.label.toLowerCase()} labels were stored.`}</p>}
    </div>
  </details>
}

function PerformanceSummary({ annotation }) {
  return <div className="analysis-performance-summary"><div className="analysis-subsection-heading"><span>Effect on the result</span><strong>{annotation.performanceLabeledCount ? `${annotation.performanceLabeledCount} agent turns labeled` : 'Not recorded'}</strong></div><p className="analysis-performance-copy">“No outcome change recorded” means the evaluator did not see this turn change the result. It does not mean the response was good or bad.</p>{annotation.performanceLabeledCount ? <div className="analysis-performance-values">{annotation.performanceSummary.map((item) => <div className={`analysis-performance-value ${item.value}`} key={item.value}><div><strong>{evidenceValue(item.value)}</strong><span>{item.count} {item.count === 1 ? 'agent turn' : 'agent turns'}</span></div>{item.count ? <BoundedList items={item.turns} itemLabel={evidenceValue(item.value).toLowerCase() + ' agent turns'} resetKey={'performance-' + item.value} className="analysis-performance-turns" renderItem={(turn, index) => <li className="analysis-performance-turn" key={turn.id + '-' + index} title={turn.id}><strong>{turnRoleLabel(turn.role)}</strong><span>{turn.preview || 'Response summary not included in this analysis version.'}</span><p>{turn.rationale || 'Rationale unclear — no explanation was saved with this label.'}</p></li>} /> : <em>No turns have this label</em>}</div>)}</div> : <p className="analysis-empty-copy">This analysis did not store a turn-effect label.</p>}</div>
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
  return <div className="analysis-filter-panel"><div className="analysis-filter-controls"><label>Evidence type<select aria-label="Evidence type" value={evidenceType} onChange={(event) => onEvidenceTypeChange(event.target.value)}>{EVIDENCE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Decision or label<select aria-label="Decision or label" value={decisionFilter} disabled={evidenceType === 'capture_gaps'} onChange={(event) => onDecisionChange(event.target.value)}>{DECISION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{filtersActive && <button type="button" className="analysis-filter-clear" onClick={onClear}>Clear filters</button>}</div><p className="analysis-filter-summary" aria-live="polite">Filters match {visibleCount.toLocaleString()} of {eligibleCount.toLocaleString()} saved records</p></div>
}

function CaptureGaps({ annotation, visible, eventContextLookup }) {
  if (!visible) return null
  const gaps = annotation.captureGaps
  const availability = !annotation.captureGapsRecorded
    ? annotation.schemaVersion === '1' ? 'Capture gaps are not represented by schema v1.' : 'Capture-gap records were not included in this analysis.'
    : gaps.length ? `${gaps.length.toLocaleString()} evidence limitations recorded.` : 'No capture gaps were recorded.'

  return <section className="analysis-capture-gaps" aria-labelledby="capture-gaps-title">
    <div className="analysis-subsection-heading">
      <div><span className="section-label">Evidence limitations</span><h4 id="capture-gaps-title">Capture gaps</h4></div>
      <strong>{annotation.captureGapsRecorded ? `${gaps.length.toLocaleString()} recorded` : 'Not included'}</strong>
    </div>
    <p className="analysis-empty-copy">{availability}</p>
    {gaps.length > 0 && <BoundedList items={gaps} itemLabel="capture gaps" ordered className="analysis-capture-gap-list" resetKey="capture-gaps" renderItem={(gap, index) => <li className="analysis-capture-gap" key={gap.category + index}>
      <div className="analysis-evidence-record-heading"><strong>{gap.category}</strong></div>
      <div className="analysis-evidence-context"><span>Limitation</span><p>{gap.summary || 'No limitation summary was saved.'}</p></div>
      <div className="analysis-evidence-context"><span>Impact</span><p>{gap.impact || 'Impact was not recorded.'}</p></div>
      {gap.eventIds.length > 0 && <RelatedEvents eventIds={gap.eventIds} eventContextLookup={eventContextLookup} label="Affected evidence" />}
    </li>} />}
  </section>
}

function AnnotationPanel({ annotation, eventContextLookup }) {
  const [evidenceType, setEvidenceType] = useState(ALL_FILTER)
  const [decisionFilter, setDecisionFilter] = useState(ALL_FILTER)

  if (!annotation.recorded) {
    return <section className="analysis-block annotation-block" aria-labelledby="annotation-title">
      <div className="analysis-block-heading">
        <div><span className="section-label">Annotation</span><h3 id="annotation-title">Reviewed evidence</h3><p>This analysis response contains no saved annotation.</p></div>
        <StatusPill tone="unknown">Not recorded</StatusPill>
      </div>
      <div className="analysis-inline-empty"><strong>Annotation not recorded</strong><span>No user-turn, agent-turn, tool, skill, or file labels were saved for this session.</span></div>
    </section>
  }

  const filteredCategories = annotation.categories
    .filter(() => evidenceType !== 'capture_gaps')
    .filter((category) => evidenceType === ALL_FILTER || category.key === evidenceType)
    .filter((category) => categorySupportsDecision(category, decisionFilter))
    .map((category) => filteredCategory(category, evidenceType, decisionFilter))
  const showCaptureGaps = decisionFilter === ALL_FILTER && (evidenceType === ALL_FILTER || evidenceType === 'capture_gaps')
  const eligibleCount = filteredCategories.reduce((total, item) => total + item.category.recordCount, 0)
    + (showCaptureGaps && annotation.captureGapsRecorded ? annotation.captureGaps.length : 0)
  const visibleCount = filteredCategories.reduce((total, item) => total + item.visibleRecords.length, 0)
    + (showCaptureGaps ? annotation.captureGaps.length : 0)
  const filtersActive = evidenceType !== ALL_FILTER || decisionFilter !== ALL_FILTER
  const filterKey = evidenceType + ':' + decisionFilter

  return <section className="analysis-block annotation-block" aria-labelledby="annotation-title">
    <div className="analysis-block-heading">
      <div><span className="section-label">Annotation</span><h3 id="annotation-title">Reviewed evidence</h3><p>Saved record counts are separate from capture coverage. Schema v2 uses saved coverage; legacy totals use saved counts or the current trace when available. Missing totals stay unavailable. Skill document reads and inferred tags are separate trace evidence.</p></div>
      <StatusPill tone="positive">Saved</StatusPill>
    </div>
    <AnnotationFilters evidenceType={evidenceType} decisionFilter={decisionFilter}
      onEvidenceTypeChange={(value) => { setEvidenceType(value); if (value === 'capture_gaps') setDecisionFilter(ALL_FILTER) }}
      onDecisionChange={setDecisionFilter}
      onClear={() => { setEvidenceType(ALL_FILTER); setDecisionFilter(ALL_FILTER) }}
      visibleCount={visibleCount} eligibleCount={eligibleCount} />
    <PerformanceSummary annotation={annotation} />
    <CaptureGaps annotation={annotation} visible={showCaptureGaps} eventContextLookup={eventContextLookup} />
    <div className="analysis-category-list">{filteredCategories.map(({ category, visibleRecords, visibleBreakdowns }) => <AnnotationCategory
      key={category.key} category={category} visibleRecords={visibleRecords} visibleBreakdowns={visibleBreakdowns}
      filtersActive={filtersActive} eventContextLookup={eventContextLookup} filterKey={filterKey} />)}</div>
  </section>
}

function SignalOccurrence({ occurrence, index, signalName, eventContextLookup }) {
  const unavailableFields = [
    ['eventKind', 'lifecycle event'],
    ['occurredAt', 'occurrence time'],
    ['summary', 'event summary'],
    ['impact', 'impact'],
  ].filter(([key]) => !occurrence[key]).map(([, label]) => label)
  const context = {
    label: signalName || 'Review signal occurrence',
    occurredAt: occurrence.occurredAt,
    details: [savedDetail('Lifecycle event', occurrence.eventKind), savedDetail('What happened', occurrence.summary), savedDetail('Why it matters', occurrence.impact)].filter(Boolean),
  }

  return <li className="analysis-signal-occurrence"><span className="analysis-signal-occurrence-index">{index + 1}</span><div className="analysis-signal-occurrence-content"><EventEvidence eventId={occurrence.eventId} eventContextLookup={eventContextLookup} contextFallback={context} referenceLabel="Occurrence event ID" referenceType="Occurrence event ID" />{unavailableFields.length > 0 && <p className="analysis-signal-occurrence-unavailable">Not recorded in this saved occurrence: {unavailableFields.join(', ')}.</p>}</div></li>
}

function signalDescriptionReferences(description) {
  const eventIds = []
  const readableDescription = description.replace(/\bObjectId\(\s*(["'])(.*?)\1\s*\)/gi, (_match, _quote, eventId) => {
    if (eventId && !eventIds.includes(eventId)) eventIds.push(eventId)
    return 'a cited event reference'
  })
  return { readableDescription, eventIds }
}

function signalOccurrenceSummary(signal) {
  const available = signal.occurrences?.length || 0
  const total = signal.count
  if (total == null) return { headline: `${available.toLocaleString()} located occurrences`, detail: available ? 'The evaluator did not record a separate total. References cited in the description are not additional occurrences.' : 'No event-level occurrence records were saved. References in the description are not occurrence records.' }
  if (!available) return { headline: 'No explicit occurrences saved', detail: `${total.toLocaleString()} occurrences were recorded as a count only. References cited in the description are shown separately and do not count as located occurrences.` }
  const missing = Math.max(total - available, 0)
  return { headline: `${available.toLocaleString()} located of ${total.toLocaleString()} recorded`, detail: missing ? `${missing.toLocaleString()} more are included in the count but have no saved occurrence detail. References cited in the description do not add to the located count.` : 'Each listed row comes from an explicit occurrence in the saved evaluation. References cited in the description are separate.' }
}

function SignalCard({ signal, index, eventContextLookup, filterKey }) {
  const summary = signalOccurrenceSummary(signal)
  const description = signalDescriptionReferences(signal.detail)
  const severityLabel = signal.severity.charAt(0).toUpperCase() + signal.severity.slice(1)

  return <li className={'analysis-signal-row ' + signal.severity} key={signal.signalKey || index}>
    <div className="analysis-signal-body">
      <strong>{signal.name}</strong>
      <span>{description.readableDescription}</span>
      <em>{signal.severityMeaning}</em>
      {description.eventIds.length > 0 && <div className="analysis-signal-description-references">
        <span>References cited in finding description</span>
        <p>These prose references are separate from occurrence records and do not change the count.</p>
        <BoundedList items={description.eventIds} itemLabel="signal references" resetKey={filterKey} className="analysis-related-events" renderItem={(eventId, referenceIndex) => <EventEvidenceRow key={eventId + '-' + referenceIndex} eventId={eventId} eventContextLookup={eventContextLookup} referenceLabel="Event ID cited in prose" />} />
      </div>}
      <details className="analysis-signal-details" open>
        <summary><strong>Occurrence details</strong><span>{summary.headline}</span></summary>
        <div className="analysis-signal-occurrences">
          {summary.detail && <p className="analysis-signal-occurrences-note">{summary.detail}</p>}
          {signal.occurrences.length
            ? <BoundedList items={signal.occurrences} itemLabel="signal occurrences" ordered className="analysis-signal-occurrence-list" resetKey={filterKey + ':' + signal.signalKey} renderItem={(occurrence, occurrenceIndex) => <SignalOccurrence key={occurrence.eventId + '-' + occurrenceIndex} occurrence={occurrence} index={occurrenceIndex} signalName={signal.name} eventContextLookup={eventContextLookup} />} />
            : <p className="analysis-empty-copy">No explicit occurrence rows were saved. IDs cited in the description are references only, not located occurrences.</p>}
        </div>
      </details>
    </div>
    <StatusPill tone={signal.severity}>{signal.count == null ? 'Count not recorded' : signal.count.toLocaleString() + ' ' + (signal.count === 1 ? 'occurrence' : 'occurrences') + ' · ' + severityLabel}</StatusPill>
  </li>
}

function ReviewSignals({ signals, eventContextLookup }) {
  const [severityFilter, setSeverityFilter] = useState(ALL_FILTER)
  const [categoryFilter, setCategoryFilter] = useState(ALL_FILTER)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const categoryOptions = Array.from(new Map(signals.map((signal) => [signal.signalKey || signal.name, signal.name])).entries())
  const filteredSignals = signals.filter((signal) => {
    if (severityFilter !== ALL_FILTER && signal.severity !== severityFilter) return false
    if (categoryFilter !== ALL_FILTER && (signal.signalKey || signal.name) !== categoryFilter) return false
    if (!normalizedQuery) return true
    return [signal.name, signal.detail, ...signal.occurrences.flatMap((occurrence) => [occurrence.eventId, occurrence.eventKind, occurrence.summary, occurrence.impact])]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalizedQuery))
  })
  const filtersActive = severityFilter !== ALL_FILTER || categoryFilter !== ALL_FILTER || Boolean(normalizedQuery)
  const filterKey = severityFilter + ':' + categoryFilter + ':' + normalizedQuery
  const clearFilters = () => { setSeverityFilter(ALL_FILTER); setCategoryFilter(ALL_FILTER); setQuery('') }

  return <div id="analysis-detailed-signals" className="analysis-subsection">
    <div className="analysis-subsection-heading"><span>Review signals</span><strong>{signals.length ? signals.length.toLocaleString() + ' recorded findings' : 'Not recorded'}</strong></div>
    {signals.length ? <>
      <p className="analysis-signal-legend">Warning and critical labels need review. Info labels provide context. Each listed occurrence is an explicit saved event, not an example parsed from the description.</p>
      <div className="analysis-signal-filters">
        <label>Severity<select aria-label="Signal severity" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option value={ALL_FILTER}>All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option><option value="unknown">Unknown</option></select></label>
        <label>Signal category<select aria-label="Signal category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value={ALL_FILTER}>All categories</option>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Find a signal or event<input aria-label="Find a signal or event" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, event ID, or evidence text" /></label>
        {filtersActive && <button type="button" className="analysis-filter-clear" onClick={clearFilters}>Clear filters</button>}
      </div>
      <p className="analysis-filter-summary" aria-live="polite">Filters match {filteredSignals.length.toLocaleString()} of {signals.length.toLocaleString()} findings</p>
      {filteredSignals.length
        ? <BoundedList items={filteredSignals} itemLabel="signal findings" resetKey={filterKey} className="analysis-signal-list" renderItem={(signal, index) => <SignalCard key={signal.signalKey || index} signal={signal} index={index} eventContextLookup={eventContextLookup} filterKey={filterKey} />} />
        : <p className="analysis-empty-copy">No findings match these filters.</p>}
    </> : <p className="analysis-empty-copy">No review signals were saved in this evaluation.</p>}
  </div>
}

function JudgeAlignment({ alignment }) {
  return <div className="analysis-subsection"><div className="analysis-subsection-heading"><span>Judge alignment</span><StatusPill tone={alignment.status === 'aligned' ? 'positive' : alignment.status === 'not_aligned' ? 'critical' : 'unknown'}>{alignment.label}</StatusPill></div><div className="analysis-alignment-grid">{alignment.humanLabel && <div><span>Human label</span><strong>{alignment.humanLabel}</strong></div>}{alignment.evaluatorLabel && <div><span>Evaluator label</span><strong>{alignment.evaluatorLabel}</strong></div>}{alignment.agreement !== null && <div><span>Agreement</span><strong>{alignment.agreement ? 'Agrees' : 'Does not agree'}</strong></div>}{alignment.dataset && <div><span>Dataset</span><strong>{alignment.dataset}</strong></div>}</div>{alignment.status === 'not_recorded' && <p className="analysis-empty-copy">Comparison unavailable: a human label and evaluator label were not both recorded.</p>}</div>
}

function reviewConcernSignals(signals = []) {
  return signals.filter((signal) => signal.severity === 'warning' || signal.severity === 'critical')
}

function evidenceCoverage(category) {
  if (!category) return { value: 'Not recorded', detail: 'agent turns labeled' }
  return {
    value: `${category.recordCount.toLocaleString()} ${category.recordCount === 1 ? 'saved record' : 'saved records'}`,
    detail: `Coverage: ${category.coverageValue} · ${category.coverageSource}`,
  }
}

function overviewReadout(verdict) {
  if (verdict === 'pass') return 'The evaluation passed.'
  if (verdict === 'fail') return 'The evaluation found issues that need attention.'
  return 'The evaluator did not record a definitive verdict.'
}

function formattedSavedTime(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function AnalysisRecordMetadata({ analysis }) {
  const entries = [
    { label: 'Annotation', schemaVersion: analysis.annotation.schemaVersion, source: analysis.annotation.source, recorded: analysis.annotation.recorded },
    { label: 'Evaluation', schemaVersion: analysis.evaluation.schemaVersion, source: analysis.evaluation.source, recorded: analysis.evaluation.recorded },
  ]

  return <section className="analysis-record-metadata" aria-label="Saved analysis record"><div className="analysis-record-metadata-heading"><strong>Current saved record</strong><span>Stored analysis details</span></div><p className="analysis-record-metadata-note">Annotation and evaluation have separate sources and schema versions with one shared update time. This response contains only the current pair; revision history is not stored, so earlier observations cannot be assigned to saved older versions here.</p><div className="analysis-record-metadata-grid">{entries.map((entry) => <div key={entry.label}><span>{entry.label}</span><strong>{entry.recorded ? `Schema v${entry.schemaVersion || 'unknown'}` : 'Not recorded'}</strong><small>{entry.recorded ? `Source: ${entry.source || 'Not recorded'}` : 'No saved record'}</small></div>)}<div><span>Last updated</span><strong><time dateTime={analysis.updatedAt || undefined}>{formattedSavedTime(analysis.updatedAt)}</time></strong><small>Shared update time for this current pair.</small></div></div></section>
}

function EvaluationOverview({ analysis }) {
  const { annotation, evaluation } = analysis
  const concerns = reviewConcernSignals(evaluation.reviewSignals)
  const coverage = evidenceCoverage(annotation.categories.find((category) => category.key === 'turns'))
  const signalCount = evaluation.reviewSignals.length
  const concernOccurrences = concerns.reduce((total, signal) => total + (signal.count || 0), 0)
  const concernOccurrenceTotalsKnown = concerns.every((signal) => signal.count !== null)
  const concernValue = concerns.length ? concerns.length.toLocaleString() : 'None'
  const concernDetail = concerns.length
    ? `${concerns.length === 1 ? 'warning or critical signal' : 'warning or critical signals'} · ${concernOccurrenceTotalsKnown ? `${concernOccurrences.toLocaleString()} recorded occurrences` : 'occurrence totals not recorded'}`
    : `${signalCount.toLocaleString()} ${signalCount === 1 ? 'signal' : 'signals'} observed`
  const actionCount = evaluation.followUps.length + evaluation.evaluationLedger.improvements.length

  return <section className={`analysis-overview ${evaluation.verdict}`} aria-labelledby="analysis-overview-title"><div className="analysis-overview-readout"><span className="section-label">Evaluation summary</span><h3 id="analysis-overview-title">Review at a glance</h3><strong className="analysis-overview-verdict">{overviewReadout(evaluation.verdict)}</strong><p>{evaluation.critique || 'No written critique was recorded.'}</p></div><div className="analysis-overview-stats"><div><span>Outcome</span><strong>{evaluation.verdictLabel}</strong><small>evaluator result</small></div><div><span>Findings</span><strong>{concernValue}</strong><small>{concernDetail}</small></div><div><span>Agent next steps</span><strong>{actionCount ? actionCount.toLocaleString() : 'None'}</strong><small>{actionCount ? 'recorded changes and finding-based follow-ups' : 'no action was recorded'}</small></div><div><span>Agent turns reviewed</span><strong>{coverage.value}</strong><small>{coverage.detail}</small></div></div></section>
}

function TurnImpactHighlights({ annotation }) {
  const neutral = annotation.performanceSummary.find((item) => item.value === 'neutral')
  const turns = annotation.performanceSummary.flatMap((item) => (item.turns || []).map((turn) => ({ ...turn, effect: item.value })))

  return <section className="analysis-highlight-block" aria-labelledby="analysis-turn-impact-title">
    <div className="analysis-highlight-heading"><h3 id="analysis-turn-impact-title">Turn impact</h3><span>{annotation.performanceLabeledCount.toLocaleString()} labeled</span></div>
    {annotation.performanceLabeledCount ? <>
      <div className="analysis-highlight-counts">{annotation.performanceSummary.map((item) => <span key={item.value}><strong>{item.count.toLocaleString()}</strong> {evidenceValue(item.value)}</span>)}</div>
      {neutral?.count > 0 && <p>“No outcome change recorded” means the evaluator saw no change to the result; it does not mean the turn was good or bad.</p>}
      {turns.length > 0 && <BoundedList items={turns} itemLabel="turn impact records" ordered className="analysis-turn-impact-list" resetKey="turn-impact" renderItem={(turn, index) => <li className="analysis-turn-impact-item" key={turn.id || index}><StatusPill tone={turn.effect === 'worsened' ? 'critical' : turn.effect === 'improved' ? 'positive' : 'unknown'}>{turn.effect === 'neutral' ? 'Neutral' : turn.effect === 'unclear' ? 'Unclear' : turn.effect === 'worsened' ? 'Worsened' : 'Improved'}</StatusPill><span>{turn.preview || 'Response summary not included in this analysis version.'}</span><p>{turn.rationale || 'Rationale unclear — no explanation was saved with this label.'}</p></li>} />}
    </> : <p>No turn effect labels were recorded. The result impact is unknown.</p>}
  </section>
}

function PriorityFindingHighlights({ signals }) {
  const concerns = reviewConcernSignals(signals)

  return <section className="analysis-highlight-block" aria-labelledby="analysis-priority-findings-title">
    <div className="analysis-highlight-heading"><h3 id="analysis-priority-findings-title">Priority findings</h3><span>{concerns.length ? `${concerns.length.toLocaleString()} warning or critical` : 'None recorded'}</span></div>
    {concerns.length ? <>
      <p>Warning and critical findings are listed first; informational signals remain in the evidence details.</p>
      <BoundedList items={concerns} itemLabel="priority findings" resetKey="priority-findings" className="analysis-priority-findings-list" renderItem={(signal, index) => <li className="analysis-priority-finding" key={signal.signalKey || index}><div><div className="analysis-priority-finding-heading"><strong>{signal.name}</strong><StatusPill tone={signal.severity}>{signal.severityMeaning}</StatusPill></div><p>{signalDescriptionReferences(signal.detail).readableDescription}</p><span>{signal.count == null ? 'Occurrence count not recorded' : `${signal.count.toLocaleString()} ${signal.count === 1 ? 'recorded occurrence' : 'recorded occurrences'}`}</span></div></li>} />
    </> : <p>No warning or critical findings were recorded{signals.length ? '. Informational signals remain in the evidence details.' : ' in this evaluation.'}</p>}
  </section>
}

function EvidenceGapHighlights({ annotation }) {
  const gaps = annotation.captureGaps
  const status = !annotation.captureGapsRecorded
    ? 'Not included'
    : gaps.length ? `${gaps.length.toLocaleString()} recorded` : 'None recorded'
  const availability = !annotation.captureGapsRecorded
    ? annotation.schemaVersion === '1' ? 'Capture gaps are not represented by schema v1.' : 'Capture-gap records were not included in this analysis.'
    : gaps.length ? 'Recorded capture limitations and their impact.' : 'No capture gaps were recorded.'

  return <section className="analysis-highlight-block" aria-labelledby="analysis-evidence-gaps-title">
    <div className="analysis-highlight-heading"><h3 id="analysis-evidence-gaps-title">Evidence gaps</h3><span>{status}</span></div>
    <p>{availability}</p>
    {gaps.length > 0 && <BoundedList items={gaps} itemLabel="evidence gaps" ordered className="analysis-evidence-gap-highlights" resetKey="evidence-gaps" renderItem={(gap, index) => <li className="analysis-evidence-gap-highlight" key={gap.category + index}><strong>{gap.category}</strong><p>{gap.summary || 'No limitation summary was saved.'}</p><span><b>Impact:</b> {gap.impact || 'Impact was not recorded.'}</span></li>} />}
  </section>
}

function EvaluationHighlights({ annotation, evaluation }) {
  return <section className="analysis-highlights" aria-label="Key result and findings">
    <TurnImpactHighlights annotation={annotation} />
    <PriorityFindingHighlights signals={evaluation.reviewSignals} />
  </section>
}
function EvidenceDisclosure({ annotation, evaluation, eventContextLookup }) {
  const categories = annotation.categories
  const categoryCount = categories.filter((category) => category.recordCount > 0).length
  const concernCount = reviewConcernSignals(evaluation.reviewSignals).length
  const evidenceSummary = [
    `${categoryCount} ${categoryCount === 1 ? 'category' : 'categories'} reviewed`,
    `${evaluation.reviewSignals.length} ${evaluation.reviewSignals.length === 1 ? 'signal' : 'signals'}`,
    concernCount ? `${concernCount} ${concernCount === 1 ? 'concern' : 'concerns'}` : 'no concerns',
  ].join(' · ')

  return <details className="analysis-evidence-disclosure"><summary><span className="analysis-disclosure-summary-copy"><span className="section-label">Audit trail</span><strong>Evidence details</strong><span>Saved turns, tool calls, skills, files, signals, and judge comparison.</span></span><span className="analysis-disclosure-summary-meta">{evidenceSummary}<span className="analysis-disclosure-toggle"><span className="analysis-disclosure-expand">Show evidence</span><span className="analysis-disclosure-collapse">Hide evidence</span></span></span></summary><div className="analysis-disclosure-content"><p className="analysis-pagination-note">Lists start with 8 rows. Load more reveals rows already loaded for this evaluation; it does not fetch additional data.</p><AnnotationPanel annotation={annotation} eventContextLookup={eventContextLookup} /><EvaluationPanel evaluation={evaluation} eventContextLookup={eventContextLookup} /></div></details>
}

function ImprovementActions({ ledger, followUps = [], eventContextLookup }) {
  const improvements = ledger?.improvements || []
  const legacyImprovements = ledger?.legacyImprovements || []
  const hasActions = improvements.length > 0
  const hasLegacyActions = legacyImprovements.length > 0
  const hasFollowUps = followUps.length > 0
  const recordedLabel = improvements.length.toLocaleString() + ' valid agent ' + (improvements.length === 1 ? 'action' : 'actions')
  const followUpLabel = followUps.length.toLocaleString() + ' ' + (followUps.length === 1 ? 'follow-up' : 'follow-ups') + ' from warning findings'
  const followUpStatusLabel = followUps.length.toLocaleString() + ' ' + (followUps.length === 1 ? 'follow-up' : 'follow-ups')
  const legacyLabel = legacyImprovements.length.toLocaleString() + ' legacy ' + (legacyImprovements.length === 1 ? 'target' : 'targets') + ' excluded'
  const statusLabel = [
    hasActions && improvements.length.toLocaleString() + ' valid',
    hasFollowUps && followUpStatusLabel,
    hasLegacyActions && legacyLabel,
  ].filter(Boolean).join(' · ')

  return <section className={'analysis-block analysis-actions-block ' + (hasActions || hasFollowUps ? 'has-actions' : 'is-empty')} aria-labelledby="analysis-actions-title">
    <div className="analysis-block-heading">
      <div>
        <span className="section-label">Action plan</span>
        <h3 id="analysis-actions-title">What to improve</h3>
        <p>Every action targets agent behavior or agent instruction Markdown. The project name is context only.</p>
      </div>
      <StatusPill tone={hasActions || hasFollowUps ? 'positive' : hasLegacyActions ? 'warning' : 'unknown'}>{statusLabel || 'No actions recorded'}</StatusPill>
    </div>
    {ledger?.project && <div className="analysis-ledger-context">
      <span>Project context</span><strong>{ledger.project}</strong>
      <p>This is the evaluated project, not an improvement target.</p>
    </div>}
    {hasActions && <div className="analysis-actions-group">
      <div className="analysis-actions-group-heading"><strong>Evaluator-recorded changes</strong><span>{recordedLabel}</span></div>
      <BoundedList items={improvements} itemLabel="agent improvement actions" ordered className="analysis-actions-list" resetKey="recorded-actions" renderItem={(improvement, index) => <li key={improvement.target + '-' + index}>
        <div className="analysis-action-field"><span>Change</span><strong>{improvement.change}</strong></div>
        <div className="analysis-action-field"><span>Target</span><strong>{improvement.targetLabel}</strong>{improvement.path && <code>{improvement.path}</code>}</div>
        <div className="analysis-action-field"><span>Why</span><p>{improvement.reason}</p></div>
        <ActionEvidence eventIds={improvement.evidenceEventIds} eventContextLookup={eventContextLookup} />
      </li>} />
    </div>}
    {hasFollowUps && <div className="analysis-actions-group analysis-derived-actions">
      <div className="analysis-actions-group-heading"><strong>Next steps from findings</strong><span>{followUpLabel}</span></div>
      <BoundedList items={followUps} itemLabel="finding-based follow-ups" ordered className="analysis-actions-list" resetKey="finding-follow-ups" renderItem={(followUp, index) => <li key={followUp.signalKey + '-' + index}>
        <div className="analysis-action-field"><span>Finding</span><strong>{followUp.title}</strong></div>
        <div className="analysis-action-field"><span>Next step for the agent</span><strong>{followUp.action}</strong></div>
        <div className="analysis-action-field"><span>Why this is here</span><p>{signalDescriptionReferences(followUp.reason || '').readableDescription}</p></div>
        <div className="analysis-action-field"><span>Target</span><strong>{followUp.targetLabel}</strong></div>
        {followUp.occurrenceCount != null && <div className="analysis-action-field"><span>Recorded occurrences</span><span>{followUp.occurrenceCount.toLocaleString()}</span></div>}
        <ActionEvidence eventIds={followUp.evidenceEventIds} eventContextLookup={eventContextLookup} />
        <span className="analysis-action-source">Suggested from a saved warning or critical finding</span>
      </li>} />
    </div>}
    {hasLegacyActions && <div className="analysis-actions-group analysis-derived-actions analysis-legacy-actions">
      <div className="analysis-actions-group-heading"><strong>Older out-of-scope targets</strong><span>{legacyLabel}</span></div>
      <p className="analysis-action-legacy-note">These older records point to project source. They remain visible for context but are excluded from the agent action plan.</p>
      <BoundedList items={legacyImprovements} itemLabel="legacy targets" ordered className="analysis-actions-list" resetKey="legacy-actions" renderItem={(improvement, index) => <li key={improvement.target + '-' + index}>
        <div className="analysis-action-field"><span>Target</span><strong>{improvement.targetLabel}</strong>{improvement.path && <code>{improvement.path}</code>}</div>
        <div className="analysis-action-field"><span>Status</span><strong>Excluded from agent improvements</strong></div>
        <div className="analysis-action-field"><span>Recorded change</span><strong>{improvement.change}</strong></div>
        <div className="analysis-action-field"><span>Why excluded</span><p>{improvement.outOfScopeReason}</p></div>
        <ActionEvidence eventIds={improvement.evidenceEventIds} eventContextLookup={eventContextLookup} />
      </li>} />
    </div>}
    {!hasActions && !hasFollowUps && !hasLegacyActions && <div className="analysis-inline-empty">
      <strong>No improvement actions recorded</strong><span>This evaluation did not save a concrete agent behavior or instruction change.</span>
    </div>}
    {!hasActions && !hasFollowUps && hasLegacyActions && <div className="analysis-inline-empty">
      <strong>No agent improvement actions recorded</strong><span>The saved evaluation contains only older targets outside the agent and instruction Markdown scope.</span>
    </div>}
  </section>
}

function ActionEvidence({ eventIds = [], eventContextLookup }) {
  return <div className="analysis-action-field">
    <span>Evidence</span>
    {eventIds.length
      ? <BoundedList items={eventIds} itemLabel="action evidence references" className="analysis-related-events" resetKey={eventIds.length} renderItem={(eventId, index) => <EventEvidenceRow key={eventId + '-' + index} eventId={eventId} eventContextLookup={eventContextLookup} referenceLabel="Action evidence ID" />} />
      : <p>Event-level evidence IDs were not stored for this action.</p>}
  </div>
}

function EvaluationPanel({ evaluation, eventContextLookup }) {
  return <section className="analysis-block evaluation-block" aria-labelledby="evaluation-title"><div className="analysis-block-heading"><div><span className="section-label">Evaluation result</span><h3 id="evaluation-title">Findings and comparison</h3><p>Open this section when you need the signal details or judge comparison behind the summary.</p></div><StatusPill tone={evaluation.verdict === 'pass' ? 'positive' : evaluation.verdict === 'fail' ? 'critical' : 'unknown'}>{evaluation.verdictLabel}</StatusPill></div>{evaluation.recorded ? <><ReviewSignals signals={evaluation.reviewSignals} eventContextLookup={eventContextLookup} /><JudgeAlignment alignment={evaluation.judgeAlignment} /></> : <div className="analysis-inline-empty"><strong>Evaluation not recorded</strong><span>No verdict, critique, review signals, or judge comparison were stored for this session.</span></div>}</section>
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

function AnalysisCards({ analysis, trace, compact = false, sessionId }) {
  if (compact) return <CompactAnalysisSummary analysis={analysis} sessionId={sessionId} />
  const eventContextLookup = createEventContextLookup(analysis.annotation, analysis.evaluation, trace)

  return <aside className={'insights-section analysis-insights analysis-full-page' + (analysis.recorded ? '' : ' is-unrecorded')} aria-labelledby="analysis-details-title">
    <div className="section-heading-row analysis-heading">
      <div>
        <p className="section-label">Evaluation review</p>
        <h2 id="analysis-details-title">Review details</h2>
        <p className="section-description">Outcome, turn impact, priorities, actions, and evidence gaps appear before the detailed audit trail.</p>
      </div>
      <StatusPill tone={analysis.recorded ? 'positive' : 'unknown'}>{analysis.recorded ? 'Recorded' : 'Not recorded'}</StatusPill>
    </div>
    {analysis.recorded ? <div className="analysis-content">
      {analysis.evaluation.recorded && <EvaluationOverview analysis={analysis} />}
      {analysis.evaluation.recorded && <EvaluationHighlights annotation={analysis.annotation} evaluation={analysis.evaluation} />}
      {analysis.evaluation.recorded && <ImprovementActions ledger={analysis.evaluation.evaluationLedger} followUps={analysis.evaluation.followUps} eventContextLookup={eventContextLookup} />}
      <EvidenceGapHighlights annotation={analysis.annotation} />
      <AnalysisRecordMetadata analysis={analysis} />
      {analysis.evaluation.recorded
        ? <EvidenceDisclosure annotation={analysis.annotation} evaluation={analysis.evaluation} eventContextLookup={eventContextLookup} />
        : <><AnnotationPanel annotation={analysis.annotation} eventContextLookup={eventContextLookup} /><EvaluationPanel evaluation={analysis.evaluation} eventContextLookup={eventContextLookup} /></>}
    </div> : <NoAnalysisState />}
  </aside>
}

export default function InsightCards({ analysis, trace, insights, compact = false, sessionId, forceAnalysis = false }) {
  const isApiTrace = analysis !== undefined || Boolean(trace && (trace.schema_version || trace.conversation || trace.timeline))
  if (!isApiTrace && !forceAnalysis) return <LegacyInsightCards insights={insights} />
  return <AnalysisCards analysis={normalizeSessionAnalysis(analysis, trace)} trace={trace} compact={compact} sessionId={sessionId} />
}
