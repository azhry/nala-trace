import { useMemo, useState } from 'react'
import ToolCallCard from './ToolCallCard'
import { getInstructionScope, instructionFilePattern, isInstructionFile, normalizePath } from './instructionScope'
import { getFileOperations, isReadFileOperation, normalizeTraceViewModel, skillNameFromFilePath } from '../traceViewModel'

const filters = [
  ['all', 'Everything'],
  ['conversation', 'Conversation'],
  ['tools', 'Tool calls'],
  ['context', 'Prompts & context'],
]
const EMPTY_EVENTS = []

function SkillTags({ skills = [] }) {
  if (!skills.length) return null
  return <span className="message-tags">{skills.map((skill) => <span className="message-tag" key={skill}>inferred / {skill}</span>)}</span>
}

function ConversationMessage({ event }) {
  const isUser = event.role === 'user'
  const body = event.hasContent === false ? 'Content not recorded' : event.body
  return <>
    {event.turnBoundary && <div className="turn-boundary" role="separator" aria-label={event.turnLabel}><span>Turn boundary</span><strong>{event.turnLabel}</strong></div>}
    <article className={`conversation-message ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-meta"><span className="message-avatar">{isUser ? 'U' : 'AI'}</span><strong>{event.roleLabel || (isUser ? 'User' : 'Codex')}</strong><span>{event.time}</span>{event.turnId && <span className="message-turn">turn {event.turnId}</span>}{event.record && <span className="message-record">record {event.record}</span>}</div>
      {event.contentIsCode ? <pre className="message-content-code">{body}</pre> : <p>{body}</p>}
      {event.partial && <span className="message-partial">partial evidence</span>}
      <SkillTags skills={event.skills} />
    </article>
  </>
}

function SystemEvent({ event }) {
  return <div className="system-event"><span className="system-event-line" /><span><strong>{event.label}</strong><small>{event.body}</small></span><span className="system-event-line" /></div>
}

function InstructionScopeBadge({ scope, compact = false }) {
  return <span className={`instruction-scope-badge ${scope.kind}`}>{compact ? scope.shortLabel : scope.label}</span>
}

function FileTag({ file }) {
  const scope = isInstructionFile(file) ? getInstructionScope(file) : null
  return <span className="context-tag file"><span>file / {file}</span>{scope && <InstructionScopeBadge scope={scope} compact />}</span>
}

function ContextRow({ event, inline = false }) {
  const isPrompt = event.contextType !== 'instruction-read'
  const title = event.contextType === 'user-prompt' ? 'User prompt' : event.contextType === 'agent-prompt' ? 'Agent prompt' : event.contextType === 'agent-reply' ? 'Agent reply' : event.contextType === 'instruction-read' ? 'Instruction read' : event.contextType === 'system-context' ? 'App context' : 'Context event'
  const agentLabel = [event.provenance?.agentType, event.provenance?.agentId].filter(Boolean).join(' · ')
  const source = event.contextType === 'user-prompt' ? 'User → Codex' : event.contextType === 'agent-prompt' || event.contextType === 'agent-reply' ? `Agent${agentLabel ? ` · ${agentLabel}` : ''}` : event.contextType === 'system-context' ? 'Codex runtime' : event.contextType === 'system-event' ? event.label || event.provenance?.eventName || 'Lifecycle event' : event.tool || 'Captured context'
  const recordLabel = event.record || event.provenance?.eventName || 'not recorded'
  return <article className={`context-row ${event.contextType} ${inline ? 'inline-context' : ''}`}>
    <div className="context-row-header">
      <div><span className="context-row-kind">{title}</span><strong>{source}</strong><small>record {recordLabel} · {event.time}</small></div>
      <span className="context-row-count">{event.files?.length || 0} files · {event.skills?.length || 0} inferred tags</span>
    </div>
    <div className="context-row-tags">{(event.files || []).map((file) => <FileTag file={file} key={`file-${file}`} />)}{(event.skills || []).map((skill) => <span className="context-tag skill" key={`skill-${skill}`}>inferred / {skill}</span>)}</div>
    <details open={isPrompt}>
      <summary>{event.contextType === 'instruction-read' ? 'Show command and content read' : event.contextType === 'agent-reply' ? 'Show recorded reply' : 'Show recorded prompt'}</summary>
      {event.body && <div className="context-code"><span>{event.contextType === 'user-prompt' ? 'prompt' : event.contextType === 'agent-reply' ? 'reply' : 'context'}</span><pre>{event.body}</pre></div>}
      {event.input && <div className="context-code"><span>tool_input</span><pre>{event.input}</pre></div>}
      {event.response && <div className="context-code"><span>tool_response / content read</span><pre>{event.response}</pre></div>}
    </details>
  </article>
}

function SkillInventory({ events, literalSkillInvocationCount = 0 }) {
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
      getFileOperations(event).forEach((record) => {
        if (isReadFileOperation(record)) addSkill(skillNameFromFilePath(record.path))
      })
    })

    return [...counts.entries()].sort(([, left], [, right]) => right.count - left.count)
  }, [events])
  const skillReadCounts = useMemo(() => {
    const counts = new Map()
    events.forEach((event) => getFileOperations(event).forEach((record) => {
      if (!isReadFileOperation(record)) return
      const normalized = normalizePath(record.path)
      const match = normalized.match(/\.agents\/skills\/([^/]+)\/SKILL\.md$/i)
      if (match) counts.set(match[1], (counts.get(match[1]) || 0) + 1)
    }))
    return [...counts.entries()].sort(([, left], [, right]) => right - left)
  }, [events])
  const inferredTagCount = skillCounts.reduce((total, [, value]) => total + value.count, 0)
  const skillReadCount = skillReadCounts.reduce((total, [, count]) => total + count, 0)
  const formatCount = (count, singular, plural = `${singular}s`) => `${count.toLocaleString()} ${count === 1 ? singular : plural}`
  const recordedLiteralSkillInvocationCount = literalSkillInvocationCount || events.reduce((total, event) => total + (event.skillRecords?.length || 0), 0)
  const skillInventoryNote = recordedLiteralSkillInvocationCount
    ? `${formatCount(recordedLiteralSkillInvocationCount, 'literal skill-invocation event')} ${recordedLiteralSkillInvocationCount === 1 ? 'was' : 'were'} recorded; inferred tags are shown separately from document reads.`
    : 'No literal skill-invocation event was emitted in the source audit; inferred tags are shown separately from document reads.'

  return <div className="skill-inventory" aria-label="Skill evidence summary">
    <div className="skill-inventory-heading">
      <div><span className="section-label">Skill evidence</span><strong>What the audit actually recorded</strong><small>{formatCount(skillReadCount, 'SKILL.md read')} across {formatCount(skillReadCounts.length, 'unique skill document')} · {formatCount(inferredTagCount, 'inferred tag occurrence')} across {formatCount(skillCounts.length, 'inferred label')}</small></div>
      <span className="record-count">from tool trace</span>
    </div>
    <div className="skill-evidence-block"><div className="skill-evidence-label"><span>Skill documents actually read</span><strong>{formatCount(skillReadCount, 'read')} · {formatCount(skillReadCounts.length, 'unique skill doc')}</strong></div>{skillReadCounts.length ? <div className="skill-inventory-list">{skillReadCounts.map(([skill, count]) => <span className="skill-inventory-item" key={`read-${skill}`}><span>skill / {skill}</span><strong>{count.toLocaleString()}</strong></span>)}</div> : <p className="skill-inventory-empty">No SKILL.md file read was recorded.</p>}</div>
    <div className="skill-evidence-block"><div className="skill-evidence-label"><span>Inferred tags attached to operations</span><strong>{formatCount(inferredTagCount, 'tag occurrence')} · {formatCount(skillCounts.length, 'label')}</strong></div>{skillCounts.length ? <div className="skill-inventory-list">{skillCounts.map(([skill, value]) => <span className="skill-inventory-item inferred" key={`tag-${skill}`}><span>inferred / {value.name}</span><strong>{value.count.toLocaleString()}</strong></span>)}</div> : null}</div>
    <p className="skill-inventory-note">{skillInventoryNote}</p>
  </div>
}

function InstructionInventory({ events }) {
  const sources = useMemo(() => {
    const counts = new Map()
    events.forEach((event) => getFileOperations(event).forEach((record) => {
      if (!instructionFilePattern.test(record.path)) return
      const path = normalizePath(record.path)
      const current = counts.get(path) || { references: 0, reads: 0 }
      current.references += 1
      if (isReadFileOperation(record)) current.reads += 1
      counts.set(path, current)
    }))
    return [...counts.entries()].sort(([, left], [, right]) => right.reads - left.reads || right.references - left.references)
  }, [events])
  const readRecords = sources.reduce((total, [, count]) => total + count.reads, 0)
  const scopeCounts = sources.reduce((counts, [path]) => {
    const scope = getInstructionScope(path)
    counts[scope.kind] += 1
    return counts
  }, { global: 0, project: 0, unknown: 0 })

  return <div className="instruction-inventory" aria-label="Instruction source inventory">
    <div className="instruction-inventory-heading"><div><span className="section-label">Instruction sources</span><strong>Files the agent referenced and read</strong><small>{readRecords.toLocaleString()} read records · {sources.length} unique instruction sources · {scopeCounts.global} global · {scopeCounts.project} local project</small></div><div className="instruction-scope-legend" aria-label="Instruction scope legend"><InstructionScopeBadge scope={{ kind: 'global', label: 'Global instruction', shortLabel: 'Global' }} /><InstructionScopeBadge scope={{ kind: 'project', label: 'Local project instruction', shortLabel: 'Local project' }} /></div></div>
    {sources.length ? <div className="instruction-source-list">{sources.map(([path, count]) => { const scope = getInstructionScope(path); return <span className="instruction-source-item" key={path}><span className="instruction-source-path">file / {path}</span><InstructionScopeBadge scope={scope} /><strong>{count.reads.toLocaleString()} reads</strong><small>{count.references.toLocaleString()} refs</small></span> })}</div> : <p className="skill-inventory-empty">No instruction-source references were recorded.</p>}
    <p className="instruction-inventory-note">Includes AGENTS.md, .agents/workflows, .agents/skills, templates, and project knowledge. Global means a user-level agent skill; Local project means this repository’s instruction files. Unknown roots are not guessed. Open “Prompts & context” to inspect each recorded command and content read.</p>
  </div>
}

function TraceStatePanel({ state, onRetry }) {
  if (state === 'loading') return <div className="trace-state-panel" role="status" aria-live="polite"><strong>Loading trace conversation…</strong><span>Reading the selected session from the protected Go API.</span></div>
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
  const viewModel = useMemo(() => normalizeTraceViewModel(session), [session])
  const events = viewModel.events || EMPTY_EVENTS
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
  const semanticRecords = String(viewModel.semanticRecords ?? 0)
  const isApiTrace = viewModel.source === 'api'
  const emptyConversation = isApiTrace && viewModel.conversation.length === 0
  const contextCounts = contextRows.reduce((counts, event) => ({ ...counts, [event.contextType]: (counts[event.contextType] || 0) + 1 }), {})

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
      <div><span>Session</span><strong>{session.id || 'Selected session'}</strong><small>{viewModel.messageCount.toLocaleString()} messages · {viewModel.conversation.filter((event) => event.role === 'user').length.toLocaleString()} user turns</small></div>
      <div><span>Tools</span><strong>{viewModel.toolCount.toLocaleString()}</strong><small>{viewModel.toolCount.toLocaleString()} captured tool rows</small></div>
      <div><span>Capture</span><strong>{viewModel.startedAt}–{viewModel.capturedAt}</strong><small>{semanticRecords} semantic records</small></div>
    </div>
    <SkillInventory events={events} literalSkillInvocationCount={viewModel.skillInvocations?.length || 0} />
    <InstructionInventory events={events} />
    <div className="context-inventory" aria-label="Prompt and context summary">
      <div><span className="section-label">Agent context</span><strong>Prompts & instructions</strong><small>{contextRows.length.toLocaleString()} captured context records · {contextCounts['user-prompt'] || 0} user prompts · {contextCounts['agent-prompt'] || 0} agent prompts · {contextCounts['agent-reply'] || 0} agent replies · {contextCounts['instruction-read'] || 0} instruction reads · {contextCounts['system-event'] || 0} context markers</small></div>
      <span className="context-inventory-note">Use “Prompts & context” below</span>
    </div>
    <div className="trace-controls" role="group" aria-label="Filter session detail">
      <span>Show</span>
      {filters.map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
      <span className="trace-visible-count">{visibleEvents.length.toLocaleString()} rows · {semanticRecords} semantic records</span>
    </div>
    <div className="trace-stream">
      {traceState !== 'ready' ? <TraceStatePanel state={traceState} onRetry={onRetry} /> : <>
        {viewModel.partial && <PartialNotice message={viewModel.partialMessage} />}
        {emptyConversation && <TraceStatePanel state="empty" />}
        {(visibleEvents.length > 0 || !emptyConversation) && <div className="stream-intro"><span className="stream-line" /><span>Trace started · {viewModel.startedAt}</span></div>}
        {visibleEvents.map((event) => event.type === 'context'
          ? <ContextRow key={event.id} event={event} />
          : event.type === 'tool'
          ? <ToolCallCard key={event.id} event={event} defaultOpen={event.index === '001'} />
          : event.type === 'system'
            ? <SystemEvent key={event.id} event={event} />
            : <ConversationMessage key={event.id} event={event} />)}
        {visibleEvents.length > 0 && <div className="stream-end"><span>End of captured session · {viewModel.capturedAt}</span><span className="stream-line" /></div>}
      </>}
    </div>
  </section>
}
