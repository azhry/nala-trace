import { useEffect, useMemo, useState } from 'react'
import ToolCallCard from './ToolCallCard'
import { getInstructionScope, instructionFilePattern, isInstructionFile, normalizePath } from './instructionScope'
import { getFileOperations, isReadFileOperation, isSkillDocumentPath, normalizeTraceViewModel, skillNameFromFilePath } from '../traceViewModel'
import { EMPTY_TOKEN_USAGE, hasRecordedTokenUsage } from '../tokenUsage'

const filters = [
  ['all', 'Everything'],
  ['conversation', 'Conversation'],
  ['tools', 'Tool calls'],
  ['context', 'Prompts & context'],
]
const EMPTY_EVENTS = []
const INITIAL_RENDER_COUNT = 60
const RENDER_BATCH_SIZE = 60

function evidencePath(file) {
  return normalizePath(file ?? '').toLowerCase()
}

function evidenceOperation(record = {}) {
  return String(record.operation ?? record.action ?? '').trim().toLowerCase() || 'ambiguous'
}

function sameFileOperation(left, right) {
  return evidencePath(left.path) === evidencePath(right.path) && evidenceOperation(left) === evidenceOperation(right)
}

function isSkillDocumentRead(record) {
  return isReadFileOperation(record) && isSkillDocumentPath(record.path)
}

function skillDocumentRecords(fileRecords, skill) {
  const target = String(skill || '').trim().toLowerCase()
  return fileRecords.filter((record) => isSkillDocumentRead(record) && skillNameFromFilePath(record.path).toLowerCase() === target)
}

function skillReadRecords(fileRecords, skill) {
  const target = String(skill || '').trim().toLowerCase()
  return fileRecords.filter((record) => isReadFileOperation(record) && skillNameFromFilePath(record.path).toLowerCase() === target)
}

function eventAnchorId(eventId) {
  return `trace-event-${encodeURIComponent(String(eventId || 'unknown'))}`
}

function eventMatchesEvidence(event, record) {
  if (getFileOperations(event).some((candidate) => sameFileOperation(candidate, record))) return true
  return Boolean(record.eventId && [event.id, event.timelineId].includes(record.eventId))
}

function SkillTags({ skills = [] }) {
  if (!skills.length) return null
  return <span className="message-tags">{skills.map((skill) => <span className="message-tag" key={skill}>inferred / {skill}</span>)}</span>
}

function ConversationMessage({ event, selected = false, active = false }) {
  const isUser = event.role === 'user'
  const body = event.hasContent === false ? 'Content not recorded' : event.body
  const usageOnly = event.usageOnlyStructuredContent && event.tokenUsage
  return <>
    {event.turnBoundary && <div className="turn-boundary" role="separator" aria-label={event.turnLabel}><span>Turn boundary</span><strong>{event.turnLabel}</strong></div>}
    <article id={eventAnchorId(event.id)} data-trace-event-id={event.id} data-trace-event-selected={selected ? 'true' : 'false'} data-trace-event-active={active ? 'true' : 'false'} tabIndex={selected ? -1 : undefined} className={`conversation-message ${isUser ? 'user' : 'assistant'} ${selected ? 'is-evidence-selected' : ''} ${active ? 'is-evidence-active' : ''}`}>
      <div className="message-meta"><span className="message-avatar">{isUser ? 'U' : 'AI'}</span><strong>{event.roleLabel || (isUser ? 'User' : 'Codex')}</strong><span>{event.time}</span>{event.turnId && <span className="message-turn">turn {event.turnId}</span>}{event.record && <span className="message-record">record {event.record}</span>}{!usageOnly && <TokenUsageMeta usage={event.tokenUsage} />}</div>
      {usageOnly ? <p className="message-usage-summary" aria-label={usageLabel(event.tokenUsage)}>Usage recorded · {usageText(event.tokenUsage)}</p> : event.contentIsCode ? <pre className="message-content-code">{body}</pre> : <p>{body}</p>}
      {event.partial && <span className="message-partial">partial evidence</span>}
      <SkillTags skills={event.skills} />
    </article>
  </>
}

function SystemEvent({ event, selected = false, active = false }) {
  return <div id={eventAnchorId(event.id)} data-trace-event-id={event.id} data-trace-event-selected={selected ? 'true' : 'false'} data-trace-event-active={active ? 'true' : 'false'} tabIndex={selected ? -1 : undefined} className={`system-event ${selected ? 'is-evidence-selected' : ''} ${active ? 'is-evidence-active' : ''}`}><span className="system-event-line" /><span><strong>{event.label}</strong><small>{event.body} <TokenUsageMeta usage={event.tokenUsage} /></small></span><span className="system-event-line" /></div>
}

function TokenUsageMeta({ usage }) {
  if (!hasRecordedTokenUsage(usage)) return null
  return <span className="token-usage-inline" aria-label={usageLabel(usage)}>{usageText(usage)}</span>
}

function usageLabel(usage) {
  const totalTokens = Number(usage.totalTokens ?? 0).toLocaleString()
  return `Event token usage: ${totalTokens} total tokens`
}

function usageText(usage) {
  const totalTokens = Number(usage.totalTokens ?? 0).toLocaleString()
  return `${totalTokens} tokens`
}

function TokenUsageSummary({ usage }) {
  const safeUsage = usage || EMPTY_TOKEN_USAGE
  const recorded = hasRecordedTokenUsage(safeUsage)
  const metrics = [
    ['Input tokens', recorded ? safeUsage.inputTokens : 'Not recorded', 'prompt tokens'],
    ['Cached input', recorded ? safeUsage.cachedInputTokens : 'Not recorded', 'cached prompt tokens'],
    ['Output tokens', recorded ? safeUsage.outputTokens : 'Not recorded', 'completion tokens'],
    ['Reasoning', recorded ? safeUsage.reasoningTokens : 'Not recorded', 'reasoning tokens'],
    ['Total tokens', recorded ? safeUsage.totalTokens : 'Not recorded', 'all token types'],
  ]

  return <div className="token-usage" role="region" aria-label="Token usage summary">
    <div className="token-usage-heading"><div><span className="section-label">Token usage</span><strong>Session consumption</strong><small>{recorded ? 'Aggregated from token usage attached to captured events.' : 'No token usage was reported by the producer.'}</small></div><span className="record-count">from session summary</span></div>
    <div className="token-usage-grid">{metrics.map(([label, value, detail]) => <div className="token-usage-metric" key={label}><span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong><small>{detail}</small></div>)}</div>
    <p className="token-usage-note">{recorded ? 'Token counts are shown exactly as recorded.' : 'No token usage was recorded for this session.'}</p>
  </div>
}

function InstructionScopeBadge({ scope, compact = false }) {
  return <span className={`instruction-scope-badge ${scope.kind}`}>{compact ? scope.shortLabel : scope.label}</span>
}

function FileTag({ file, onSelect }) {
  const scope = isInstructionFile(file) ? getInstructionScope(file) : null
  const content = <><span>file / {file}</span>{scope && <InstructionScopeBadge scope={scope} compact />}</>
  if (!onSelect) return <span className="context-tag file">{content}</span>
  return <button type="button" className="context-tag file" aria-label={`Locate captured file ${file} in the trace`} title={`Locate captured file ${file} in the trace`} onClick={() => onSelect(file)}>{content}</button>
}

function ContextRow({ event, inline = false, selected = false, active = false, onFileSelect }) {
  const isPrompt = event.contextType !== 'instruction-read'
  const title = event.contextType === 'user-prompt' ? 'User prompt' : event.contextType === 'agent-prompt' ? 'Agent prompt' : event.contextType === 'agent-reply' ? 'Agent reply' : event.contextType === 'instruction-read' ? 'Instruction read' : event.contextType === 'system-context' ? 'App context' : 'Context event'
  const agentLabel = [event.provenance?.agentType, event.provenance?.agentId].filter(Boolean).join(' · ')
  const source = event.contextType === 'user-prompt' ? 'User → Codex' : event.contextType === 'agent-prompt' || event.contextType === 'agent-reply' ? `Agent${agentLabel ? ` · ${agentLabel}` : ''}` : event.contextType === 'system-context' ? 'Codex runtime' : event.contextType === 'system-event' ? event.label || event.provenance?.eventName || 'Lifecycle event' : event.tool || 'Captured context'
  const recordLabel = event.record || event.provenance?.eventName || 'not recorded'
  return <article id={eventAnchorId(event.id)} data-trace-event-id={event.id} data-trace-event-selected={selected ? 'true' : 'false'} data-trace-event-active={active ? 'true' : 'false'} tabIndex={selected ? -1 : undefined} className={`context-row ${event.contextType} ${inline ? 'inline-context' : ''} ${selected ? 'is-evidence-selected' : ''} ${active ? 'is-evidence-active' : ''}`}>
    <div className="context-row-header">
      <div><span className="context-row-kind">{title}</span><strong>{source}</strong><small>record {recordLabel} · {event.time}</small></div>
      <span className="context-row-count">{event.files?.length || 0} files · {event.skills?.length || 0} inferred tags</span>
    </div>
    <div className="context-row-tags">{(event.files || []).map((file) => <FileTag file={file} key={`file-${file}`} onSelect={onFileSelect} />)}{(event.skills || []).map((skill) => <span className="context-tag skill" key={`skill-${skill}`}>inferred / {skill}</span>)}</div>
    <details open={isPrompt}>
      <summary>{event.contextType === 'instruction-read' ? 'Show command and content read' : event.contextType === 'agent-reply' ? 'Show recorded reply' : 'Show recorded prompt'}</summary>
      {event.body && <div className="context-code"><span>{event.contextType === 'user-prompt' ? 'prompt' : event.contextType === 'agent-reply' ? 'reply' : 'context'}</span><pre>{event.body}</pre></div>}
      {event.input && <div className="context-code"><span>tool_input</span><pre>{event.input}</pre></div>}
      {event.response && <div className="context-code"><span>tool_response / content read</span><pre>{event.response}</pre></div>}
    </details>
  </article>
}

function SkillInventory({ events, fileRecords = EMPTY_EVENTS, capturedSkillEvidenceCount = 0, onEvidenceSelect, selectedEvidenceKey = '' }) {
  const skillCounts = useMemo(() => {
    const counts = new Map()
    const addSkill = (skill) => {
      const name = String(skill || '').trim()
      if (!name) return
      const key = name.toLowerCase()
      const current = counts.get(key) || { name, count: 0 }
      current.count += 1
      counts.set(key, current)
    }

    events.forEach((event) => {
      const skillRecords = Array.isArray(event.skillRecords) && event.skillRecords.length
        ? event.skillRecords.filter((record) => record.confidence !== 'explicit')
        : (event.skills || []).map((name) => ({ name }))
      skillRecords.forEach((record) => addSkill(record.name))
    })
    fileRecords.forEach((record) => {
      if (isReadFileOperation(record)) addSkill(skillNameFromFilePath(record.path))
    })

    return [...counts.entries()].sort(([, left], [, right]) => right.count - left.count)
  }, [events, fileRecords])
  const skillReadCounts = useMemo(() => {
    const counts = new Map()
    fileRecords.forEach((record) => {
      if (!isReadFileOperation(record)) return
      if (!isSkillDocumentPath(record.path)) return
      const skill = skillNameFromFilePath(record.path)
      if (skill) counts.set(skill, (counts.get(skill) || 0) + 1)
    })
    return [...counts.entries()].sort(([, left], [, right]) => right - left)
  }, [fileRecords])
  const inferredTagCount = skillCounts.reduce((total, [, value]) => total + value.count, 0)
  const skillReadCount = skillReadCounts.reduce((total, [, count]) => total + count, 0)
  const formatCount = (count, singular, plural = `${singular}s`) => `${count.toLocaleString()} ${count === 1 ? singular : plural}`
  const recordedSkillEvidenceCount = capturedSkillEvidenceCount || events.reduce((total, event) => total + (event.skillRecords?.length || 0), 0)
  const skillInventoryNote = recordedSkillEvidenceCount
    ? `${formatCount(recordedSkillEvidenceCount, 'captured skill evidence record')} ${recordedSkillEvidenceCount === 1 ? 'was' : 'were'} recorded as ${recordedSkillEvidenceCount === 1 ? 'a skill invocation' : 'skill invocations'}; inferred tags are shown separately from document reads.`
    : 'No captured skill evidence or skill invocation was recorded in the source audit; inferred tags are shown separately from document reads.'
  const selectSkill = (skill, documentsOnly = false) => onEvidenceSelect?.({
    key: `skill:${skill.toLowerCase()}`,
    label: `skill ${skill}`,
    records: documentsOnly ? skillDocumentRecords(fileRecords, skill) : skillReadRecords(fileRecords, skill),
  })

  return <div className="skill-inventory" aria-label="Skill evidence summary">
    <div className="skill-inventory-heading">
      <div><span className="section-label">Skill evidence</span><strong>What the audit actually recorded</strong><small>{formatCount(skillReadCount, 'SKILL.md read')} across {formatCount(skillReadCounts.length, 'unique skill document')} · {formatCount(inferredTagCount, 'inferred tag occurrence')} across {formatCount(skillCounts.length, 'inferred label')}</small></div>
      <span className="record-count">from tool trace</span>
    </div>
    <div className="skill-evidence-block"><div className="skill-evidence-label"><span>Skill documents actually read</span><strong>{formatCount(skillReadCount, 'read')} · {formatCount(skillReadCounts.length, 'unique skill doc')}</strong></div>{skillReadCounts.length ? <div className="skill-inventory-list">{skillReadCounts.map(([skill, count]) => <button type="button" className="skill-inventory-item" key={`read-${skill}`} aria-label={`Locate captured skill ${skill} in the trace`} title={`Locate captured skill ${skill} in the trace`} aria-pressed={selectedEvidenceKey === `skill:${skill.toLowerCase()}`} onClick={() => selectSkill(skill, true)}><span>skill / {skill}</span><strong>{count.toLocaleString()}</strong></button>)}</div> : <p className="skill-inventory-empty">No SKILL.md file read was recorded.</p>}</div>
    <div className="skill-evidence-block"><div className="skill-evidence-label"><span>Inferred tags attached to operations</span><strong>{formatCount(inferredTagCount, 'tag occurrence')} · {formatCount(skillCounts.length, 'label')}</strong></div>{skillCounts.length ? <div className="skill-inventory-list">{skillCounts.map(([skill, value]) => <button type="button" className="skill-inventory-item inferred" key={`tag-${skill}`} aria-label={`Locate inferred skill ${value.name} in the trace`} title={`Locate inferred skill ${value.name} in the trace`} aria-pressed={selectedEvidenceKey === `skill:${skill}`} onClick={() => selectSkill(value.name)}><span>inferred / {value.name}</span><strong>{value.count.toLocaleString()}</strong></button>)}</div> : null}</div>
    <p className="skill-inventory-note">{skillInventoryNote}</p>
  </div>
}

function InstructionInventory({ fileRecords = EMPTY_EVENTS, onEvidenceSelect, selectedEvidenceKey = '' }) {
  const sources = useMemo(() => {
    const counts = new Map()
    fileRecords.forEach((record) => {
      if (!instructionFilePattern.test(record.path)) return
      const path = normalizePath(record.path)
      const current = counts.get(path) || { references: 0, reads: 0 }
      current.references += 1
      if (isReadFileOperation(record)) current.reads += 1
      counts.set(path, current)
    })
    return [...counts.entries()].sort(([, left], [, right]) => right.reads - left.reads || right.references - left.references)
  }, [fileRecords])
  const readRecords = sources.reduce((total, [, count]) => total + count.reads, 0)
  const scopeCounts = sources.reduce((counts, [path]) => {
    const scope = getInstructionScope(path)
    counts[scope.kind] += 1
    return counts
  }, { global: 0, project: 0, unknown: 0 })
  const selectSource = (path) => onEvidenceSelect?.({
    key: `file:${evidencePath(path)}`,
    label: path,
    records: fileRecords.filter((record) => evidencePath(record.path) === evidencePath(path)),
  })

  return <div className="instruction-inventory" aria-label="Instruction source inventory">
    <div className="instruction-inventory-heading"><div><span className="section-label">Instruction sources</span><strong>Files the agent referenced and read</strong><small>{readRecords.toLocaleString()} read records · {sources.length} unique instruction sources · {scopeCounts.global} global · {scopeCounts.project} local project</small></div><div className="instruction-scope-legend" aria-label="Instruction scope legend"><InstructionScopeBadge scope={{ kind: 'global', label: 'Global instruction', shortLabel: 'Global' }} /><InstructionScopeBadge scope={{ kind: 'project', label: 'Local project instruction', shortLabel: 'Local project' }} /></div></div>
    {sources.length ? <div className="instruction-source-list">{sources.map(([path, count]) => { const scope = getInstructionScope(path); const key = `file:${evidencePath(path)}`; return <button type="button" className="instruction-source-item" key={path} aria-label={`Locate captured instruction source ${path} in the trace`} title={`Locate captured instruction source ${path} in the trace`} aria-pressed={selectedEvidenceKey === key} onClick={() => selectSource(path)}><span className="instruction-source-path">file / {path}</span><InstructionScopeBadge scope={scope} /><strong>{count.reads.toLocaleString()} reads</strong><small>{count.references.toLocaleString()} refs</small></button> })}</div> : <p className="skill-inventory-empty">No instruction-source references were recorded.</p>}
    <p className="instruction-inventory-note">Includes AGENTS.md, .agents/workflows, .agents/skills, templates, and project knowledge. Global means a user-level agent skill; Local project means this repository’s instruction files. Unknown roots are not guessed. Open “Prompts & context” to inspect each recorded command and content read.</p>
  </div>
}

function McpInventory({ callCount = 0, servers = EMPTY_EVENTS }) {
  const safeCallCount = Number.isFinite(Number(callCount)) ? Number(callCount) : 0
  const safeServers = Array.isArray(servers) ? servers.filter((server) => typeof server === 'string' && server.trim()) : EMPTY_EVENTS
  const serverSummary = safeServers.length ? safeServers.join(', ') : ''
  const emptyMessage = safeCallCount === 0 && safeServers.length === 0
    ? 'No MCP calls or MCP servers were recorded.'
    : 'MCP server names were not recorded for these calls.'

  return <div className="mcp-inventory" role="region" aria-label="MCP usage summary">
    <div className="mcp-inventory-heading"><div><span className="section-label">MCP usage</span><strong>Recorded MCP calls and servers</strong><small>{safeCallCount.toLocaleString()} MCP calls · {safeServers.length.toLocaleString()} distinct server{safeServers.length === 1 ? '' : 's'}</small></div><span className="record-count">from session summary</span></div>
    {safeServers.length ? <div className="mcp-server-list" aria-label={`MCP servers used: ${serverSummary}`}>{safeServers.map((server) => <span className="mcp-server-chip" key={server}>{server}</span>)}</div> : <p className="mcp-inventory-empty">{emptyMessage}</p>}
  </div>
}

function EvidenceSelectionNotice({ selection, onClear, onPrevious, onNext }) {
  if (!selection) return null
  const matchCount = selection.eventIds.length
  const activeMatchIndex = matchCount ? Math.min(selection.activeMatchIndex ?? 0, matchCount - 1) : -1
  const matchedMessage = matchCount
    ? `${selection.eventIds.length} matching timeline event${selection.eventIds.length === 1 ? '' : 's'} selected.`
    : 'No matching timeline event was found.'
  const unmatchedMessage = selection.unmatchedRecordCount
    ? ` ${selection.unmatchedRecordCount} captured record${selection.unmatchedRecordCount === 1 ? '' : 's'} ${selection.unmatchedRecordCount === 1 ? 'has' : 'have'} no matching timeline event; no event was invented.`
    : ''
  return <>
    <div className="evidence-selection-notice" role="status" aria-live="polite">
      <strong>{selection.label}</strong>
      <span>{matchedMessage}{unmatchedMessage}</span>
    </div>
    <div className="evidence-match-dock" role="group" aria-label="Evidence match navigation">
      {matchCount > 0 && <div className="evidence-match-navigation">
        <span aria-live="polite">Match {activeMatchIndex + 1} of {matchCount}</span>
        <button type="button" className="evidence-match-control" aria-label="Previous matching event" title="Previous matching event" disabled={activeMatchIndex <= 0} onClick={onPrevious}>Previous</button>
        <button type="button" className="evidence-match-control" aria-label="Next matching event" title="Next matching event" disabled={activeMatchIndex >= matchCount - 1} onClick={onNext}>Next</button>
      </div>}
      <button type="button" className="evidence-clear" onClick={onClear}>Clear selection</button>
    </div>
  </>
}

export function TraceLoadingPanel({ title = 'Loading trace conversation…', detail = 'Reading the selected session from the protected Go API.' } = {}) {
  return <div className="trace-state-panel trace-loading-panel" role="status" aria-live="polite" aria-busy="true"><div className="trace-loader-mark" aria-hidden="true"><span /><span /><span /></div><div className="trace-loading-content"><strong>{title}</strong><span>{detail}</span></div><div className="trace-loading-skeletons" aria-hidden="true"><span /><span /><span /></div></div>
}

function TraceStatePanel({ state, onRetry }) {
  if (state === 'loading') return <TraceLoadingPanel />
  if (state === 'missing') return <div className="trace-state-panel" role="alert"><strong>Session trace not found.</strong><span>No stored events were returned for this session.</span><button type="button" className="state-action" onClick={() => onRetry()}>Retry request</button></div>
  if (state === 'unauthorized') return <div className="trace-state-panel" role="alert"><strong>Trace access needs authentication.</strong><span>The trace request was rejected. Refresh the application session, then retry.</span><button type="button" className="state-action" onClick={() => onRetry()}>Retry request</button></div>
  if (state === 'error') return <div className="trace-state-panel" role="alert"><strong>Trace conversation could not be loaded.</strong><span>The protected trace request failed before conversation data was available.</span><button type="button" className="state-action" onClick={() => onRetry()}>Retry request</button></div>
  if (state === 'empty') return <div className="trace-state-panel" role="status"><strong>No conversation messages were recorded.</strong><span>This session has no reconstructed user or assistant content to display.</span></div>
  return null
}

function PartialNotice({ message }) {
  return <div className="trace-partial-notice" role="status"><strong>Partial conversation data</strong><span>{message}</span></div>
}

export default function TraceView({ session = {}, traceState = 'ready', onRetry = () => {} }) {
  const [filter, setFilter] = useState('all')
  const [selection, setSelection] = useState(null)
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_COUNT)
  const viewModel = useMemo(() => normalizeTraceViewModel(session), [session])
  const events = viewModel.events || EMPTY_EVENTS
  const sessionKey = session.id || session.session_id || viewModel.sessionId || 'selected-session'
  const contextRows = useMemo(() => {
    const rows = []
    events.forEach((event) => {
      if (event.type === 'context') {
        rows.push({ ...event, id: `context-${event.id}`, type: 'context', contextType: event.contextType || 'system-event' })
      } else if (event.type === 'system') {
        rows.push({ ...event, id: `context-${event.id}`, type: 'context', contextType: 'system-event' })
      } else if (event.type === 'user') {
        rows.push({ ...event, id: `context-${event.id}`, type: 'context', contextType: 'user-prompt' })
      } else if (event.type === 'assistant' && /<app-context>|<skills_instructions>/.test(event.body || '')) {
        rows.push({ ...event, id: `context-${event.id}`, type: 'context', contextType: 'system-context' })
      } else if (event.type === 'tool') {
        const instructionFiles = (event.files || []).filter((file) => instructionFilePattern.test(file))
        const isAgentPrompt = /multi_agent_v1__(spawn_agent|send_input)/.test(event.tool || '')
        if (isAgentPrompt || instructionFiles.length || event.lifecycleEvent) {
          rows.push({ ...event, id: `context-${event.id}`, type: 'context', contextType: isAgentPrompt ? 'agent-prompt' : instructionFiles.length ? 'instruction-read' : 'system-event', files: instructionFiles.length ? instructionFiles : event.files })
        }
      }
    })
    return rows
  }, [events])
  const visibleEvents = useMemo(() => {
    if (filter === 'context') return contextRows
    return events.filter((event) => {
      if (filter === 'all') return true
      if (filter === 'conversation') return event.type === 'user' || event.type === 'assistant'
      if (filter === 'tools') return event.type === 'tool'
      return event.type === 'system'
    })
  }, [contextRows, events, filter])
  const renderedEvents = useMemo(() => visibleEvents.slice(0, renderLimit), [visibleEvents, renderLimit])
  const hasMoreEvents = renderedEvents.length < visibleEvents.length
  const semanticRecords = String(viewModel.semanticRecords ?? 0)
  const isApiTrace = viewModel.source === 'api'
  const emptyConversation = isApiTrace && viewModel.conversation.length === 0
  const contextCounts = contextRows.reduce((counts, event) => ({ ...counts, [event.contextType]: (counts[event.contextType] || 0) + 1 }), {})
  const inventoryFiles = viewModel.source === 'api' ? viewModel.files : events.flatMap(getFileOperations)
  const changeFilter = (nextFilter) => {
    setFilter(nextFilter)
    setRenderLimit(INITIAL_RENDER_COUNT)
  }
  const selectEvidence = ({ key, label, records = EMPTY_EVENTS }) => {
    const matchingEvents = events.filter((event) => records.some((record) => eventMatchesEvidence(event, record)))
    const eventIds = [...new Set(matchingEvents.map((event) => event.id).filter(Boolean))]
    const matchedRecordCount = records.filter((record) => matchingEvents.some((event) => eventMatchesEvidence(event, record))).length
    setSelection({ key, label, eventIds, activeMatchIndex: 0, unmatchedRecordCount: records.length - matchedRecordCount })
    changeFilter('all')
  }
  const selectFile = (file) => selectEvidence({
    key: `file:${evidencePath(file)}`,
    label: `file / ${file}`,
    records: inventoryFiles.filter((record) => evidencePath(record.path) === evidencePath(file)),
  })
  const moveToMatch = (offset) => {
    setSelection((current) => {
      if (!current?.eventIds.length) return current
      const currentIndex = current.activeMatchIndex ?? 0
      const activeMatchIndex = Math.max(0, Math.min(currentIndex + offset, current.eventIds.length - 1))
      return { ...current, activeMatchIndex }
    })
    changeFilter('all')
  }

  useEffect(() => {
    setSelection(null)
    setRenderLimit(INITIAL_RENDER_COUNT)
  }, [sessionKey])

  useEffect(() => {
    if (!selection?.eventIds.length) return
    const activeMatchIndex = Math.min(selection.activeMatchIndex ?? 0, selection.eventIds.length - 1)
    const activeEventId = selection.eventIds[activeMatchIndex]
    const activeEventIndex = visibleEvents.findIndex((event) => event.id === activeEventId)
    if (activeEventIndex >= renderLimit) {
      setRenderLimit(Math.min(visibleEvents.length, activeEventIndex + 1))
      return
    }
    const target = document.getElementById(eventAnchorId(selection.eventIds[activeMatchIndex]))
    if (target?.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target?.focus?.({ preventScroll: true })
  }, [selection, visibleEvents, renderLimit])

  const loadMoreEvents = () => {
    setRenderLimit((current) => Math.min(current + RENDER_BATCH_SIZE, visibleEvents.length))
  }

  return <section className="panel trace-panel" aria-labelledby="trace-view-title">
    <div className="panel-header trace-panel-header">
      <div>
        <p className="section-label">Conversation and trace</p>
        <h2 id="trace-view-title">Session detail</h2>
        <p className="panel-description">The captured event stream: User and Codex turns, recorded tool calls with paired output, lifecycle/context markers, file and instruction references, and skill tags. Private model reasoning is not part of the hook data.</p>
      </div>
      <span className="record-count">{semanticRecords} records</span>
    </div>
    <div className="trace-summary">
      <div><span>Skill invocations</span><strong>{Number(viewModel.skillInvocationCount ?? 0).toLocaleString()}</strong><small>captured invocation records</small></div>
      <div><span>Tools</span><strong>{viewModel.toolCount.toLocaleString()}</strong><small>{viewModel.toolCount.toLocaleString()} captured tool rows</small></div>
      <div><span>MCP</span><strong>{(viewModel.mcpCallCount || 0).toLocaleString()} calls</strong><small>{(viewModel.mcpServers?.length || 0).toLocaleString()} distinct servers</small></div>
      <div><span>Capture</span><strong>{viewModel.startedAt}–{viewModel.capturedAt}</strong><small>{semanticRecords} semantic records</small></div>
    </div>
    <TokenUsageSummary usage={viewModel.tokenUsage} />
    <SkillInventory events={events} fileRecords={inventoryFiles} capturedSkillEvidenceCount={viewModel.skillInvocations?.length || 0} onEvidenceSelect={selectEvidence} selectedEvidenceKey={selection?.key || ''} />
    <McpInventory callCount={viewModel.mcpCallCount} servers={viewModel.mcpServers} />
    <InstructionInventory fileRecords={inventoryFiles} onEvidenceSelect={selectEvidence} selectedEvidenceKey={selection?.key || ''} />
    <div className="context-inventory" aria-label="Prompt and context summary">
      <div><span className="section-label">Agent context</span><strong>Prompts & instructions</strong><small>{contextRows.length.toLocaleString()} captured context records · {contextCounts['user-prompt'] || 0} user prompts · {contextCounts['agent-prompt'] || 0} agent prompts · {contextCounts['agent-reply'] || 0} agent replies · {contextCounts['instruction-read'] || 0} instruction reads · {contextCounts['system-event'] || 0} context markers</small></div>
      <span className="context-inventory-note">Use “Prompts & context” below</span>
    </div>
    <EvidenceSelectionNotice selection={selection} onClear={() => setSelection(null)} onPrevious={() => moveToMatch(-1)} onNext={() => moveToMatch(1)} />
    <div className="trace-controls" role="group" aria-label="Filter session detail">
      <span>Show</span>
      {filters.map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} aria-pressed={filter === id} onClick={() => changeFilter(id)}>{label}</button>)}
      <span className="trace-visible-count">{visibleEvents.length.toLocaleString()} rows · {semanticRecords} semantic records</span>
    </div>
    <div className="trace-stream">
      {traceState !== 'ready' ? <TraceStatePanel state={traceState} onRetry={onRetry} /> : <>
        {viewModel.partial && <PartialNotice message={viewModel.partialMessage} />}
        {emptyConversation && <TraceStatePanel state="empty" />}
        {(visibleEvents.length > 0 || !emptyConversation) && <div className="stream-intro"><span className="stream-line" /><span>Trace started · {viewModel.startedAt}</span></div>}
        {renderedEvents.map((event) => {
          const selected = selection?.eventIds.includes(event.id) || false
          const active = selected && selection?.eventIds[selection.activeMatchIndex ?? 0] === event.id
          if (event.type === 'context') return <ContextRow key={event.id} event={event} selected={selected} active={active} onFileSelect={selectFile} />
          if (event.type === 'tool') return <ToolCallCard key={event.id} event={event} defaultOpen={event.index === '001'} selected={selected} active={active} />
          if (event.type === 'system') return <SystemEvent key={event.id} event={event} selected={selected} active={active} />
          return <ConversationMessage key={event.id} event={event} selected={selected} active={active} />
        })}
        <div className="trace-stream-pagination">
          <span role="status" aria-live="polite">Showing {renderedEvents.length.toLocaleString()} of {visibleEvents.length.toLocaleString()} rows</span>
          {hasMoreEvents && <button type="button" className="load-more-events" onClick={loadMoreEvents}>Load more rows</button>}
        </div>
        {!hasMoreEvents && visibleEvents.length > 0 && <div className="stream-end"><span>End of captured session · {viewModel.capturedAt}</span><span className="stream-line" /></div>}
      </>}
    </div>
  </section>
}
