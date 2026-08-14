import { useMemo, useState } from 'react'
import ToolCallCard from './ToolCallCard'

const filters = [
  ['all', 'Everything'],
  ['conversation', 'Conversation'],
  ['tools', 'Tool calls'],
  ['context', 'Prompts & context'],
]
const EMPTY_EVENTS = []
const instructionFilePattern = /agents|AGENTS\.md|SKILL\.md|TOOLING\.md|CONTEXT\.md|workflow/i

function normalizePath(file) {
  return file.replaceAll('\\', '/').replaceAll('//', '/').replace(/(\.md|\.ps1|\.yml)\/n$/i, '$1')
}

function SkillTags({ skills = [] }) {
  if (!skills.length) return null
  return <span className="message-tags">{skills.map((skill) => <span className="message-tag" key={skill}>inferred / {skill}</span>)}</span>
}

function ConversationMessage({ event }) {
  const isUser = event.role === 'user'
  return <article className={`conversation-message ${isUser ? 'user' : 'assistant'}`}>
    <div className="message-meta"><span className="message-avatar">{isUser ? 'U' : 'AI'}</span><strong>{isUser ? 'User' : 'Codex'}</strong><span>{event.time}</span><span className="message-record">record {event.record}</span></div>
    <p>{event.body}</p>
    <SkillTags skills={event.skills} />
  </article>
}

function SystemEvent({ event }) {
  return <div className="system-event"><span className="system-event-line" /><span><strong>{event.label}</strong><small>{event.body}</small></span><span className="system-event-line" /></div>
}

function ContextRow({ event }) {
  const isPrompt = event.contextType !== 'instruction-read'
  const title = event.contextType === 'user-prompt' ? 'User prompt' : event.contextType === 'agent-prompt' ? 'Agent prompt' : event.contextType === 'instruction-read' ? 'Instruction read' : event.contextType === 'system-context' ? 'App context' : 'Context event'
  const source = event.contextType === 'user-prompt' ? 'User → Codex' : event.contextType === 'system-context' ? 'Codex runtime' : event.contextType === 'system-event' ? event.label : event.tool || 'Captured context'
  return <article className={`context-row ${event.contextType}`}>
    <div className="context-row-header">
      <div><span className="context-row-kind">{title}</span><strong>{source}</strong><small>record {event.record} · {event.time}</small></div>
      <span className="context-row-count">{event.files?.length || 0} files · {event.skills?.length || 0} inferred tags</span>
    </div>
    <div className="context-row-tags">{(event.files || []).map((file) => <span className="context-tag file" key={`file-${file}`}>file / {file}</span>)}{(event.skills || []).map((skill) => <span className="context-tag skill" key={`skill-${skill}`}>inferred / {skill}</span>)}</div>
    <details open={isPrompt}>
      <summary>{event.contextType === 'instruction-read' ? 'Show command and content read' : 'Show recorded prompt'}</summary>
      {event.body && <div className="context-code"><span>{event.contextType === 'user-prompt' ? 'prompt' : 'context'}</span><pre>{event.body}</pre></div>}
      {event.input && <div className="context-code"><span>tool_input</span><pre>{event.input}</pre></div>}
      {event.response && <div className="context-code"><span>tool_response / content read</span><pre>{event.response}</pre></div>}
    </details>
  </article>
}

function SkillInventory({ events }) {
  const skillCounts = useMemo(() => {
    const counts = new Map()
    events.forEach((event) => (event.skills || []).forEach((skill) => counts.set(skill, (counts.get(skill) || 0) + 1)))
    return [...counts.entries()].sort(([, left], [, right]) => right - left)
  }, [events])
  const skillReadCounts = useMemo(() => {
    const counts = new Map()
    events.forEach((event) => (event.files || []).forEach((file) => {
      const normalized = normalizePath(file)
      const match = normalized.match(/\.agents\/skills\/([^/]+)\/SKILL\.md$/i)
      if (match) counts.set(match[1], (counts.get(match[1]) || 0) + 1)
    }))
    return [...counts.entries()].sort(([, left], [, right]) => right - left)
  }, [events])
  const inferredTagCount = skillCounts.reduce((total, [, count]) => total + count, 0)
  const skillReadCount = skillReadCounts.reduce((total, [, count]) => total + count, 0)
  const formatCount = (count, singular, plural = `${singular}s`) => `${count.toLocaleString()} ${count === 1 ? singular : plural}`

  return <div className="skill-inventory" aria-label="Skill evidence summary">
    <div className="skill-inventory-heading">
      <div><span className="section-label">Skill evidence</span><strong>What the audit actually recorded</strong><small>{formatCount(skillReadCount, 'SKILL.md read')} across {formatCount(skillReadCounts.length, 'unique skill document')} · {formatCount(inferredTagCount, 'inferred tag occurrence')} across {formatCount(skillCounts.length, 'inferred label')}</small></div>
      <span className="record-count">from tool trace</span>
    </div>
    <div className="skill-evidence-block"><div className="skill-evidence-label"><span>Skill documents actually read</span><strong>{formatCount(skillReadCount, 'read')} · {formatCount(skillReadCounts.length, 'unique skill doc')}</strong></div>{skillReadCounts.length ? <div className="skill-inventory-list">{skillReadCounts.map(([skill, count]) => <span className="skill-inventory-item" key={`read-${skill}`}><span>skill / {skill}</span><strong>{count.toLocaleString()}</strong></span>)}</div> : <p className="skill-inventory-empty">No SKILL.md file read was recorded.</p>}</div>
    <div className="skill-evidence-block"><div className="skill-evidence-label"><span>Inferred tags attached to operations</span><strong>{formatCount(inferredTagCount, 'tag occurrence')} · {formatCount(skillCounts.length, 'label')}</strong></div>{skillCounts.length ? <div className="skill-inventory-list">{skillCounts.map(([skill, count]) => <span className="skill-inventory-item inferred" key={`tag-${skill}`}><span>inferred / {skill}</span><strong>{count.toLocaleString()}</strong></span>)}</div> : null}</div>
    <p className="skill-inventory-note">No literal skill-invocation event was emitted in the source audit; inferred tags are shown separately from document reads.</p>
  </div>
}

function InstructionInventory({ events }) {
  const sources = useMemo(() => {
    const counts = new Map()
    events.forEach((event) => (event.files || []).forEach((file) => {
      if (!instructionFilePattern.test(file)) return
      const path = normalizePath(file)
      const current = counts.get(path) || { references: 0, reads: 0 }
      current.references += 1
      if (event.action === 'read') current.reads += 1
      counts.set(path, current)
    }))
    return [...counts.entries()].sort(([, left], [, right]) => right.reads - left.reads || right.references - left.references)
  }, [events])
  const readRecords = sources.reduce((total, [, count]) => total + count.reads, 0)

  return <div className="instruction-inventory" aria-label="Instruction source inventory">
    <div className="instruction-inventory-heading"><div><span className="section-label">Instruction sources</span><strong>Files the agent referenced and read</strong><small>{readRecords.toLocaleString()} read records · {sources.length} unique instruction sources</small></div><span className="record-count">root + .agents</span></div>
    {sources.length ? <div className="instruction-source-list">{sources.map(([path, count]) => <span className="instruction-source-item" key={path}><span>file / {path}</span><strong>{count.reads.toLocaleString()} reads</strong><small>{count.references.toLocaleString()} refs</small></span>)}</div> : <p className="skill-inventory-empty">No instruction-source references were recorded.</p>}
    <p className="instruction-inventory-note">Includes AGENTS.md, .agents/workflows, .agents/skills, templates, and project knowledge. Open “Prompts & context” to inspect each recorded command and content read.</p>
  </div>
}

export default function TraceView({ session }) {
  const [filter, setFilter] = useState('all')
  const events = session.eventsList || EMPTY_EVENTS
  const contextRows = useMemo(() => {
    const rows = []
    events.forEach((event) => {
      if (event.type === 'system') {
        rows.push({ ...event, id: `context-${event.id}`, type: 'context', contextType: 'system-event' })
      } else if (event.type === 'user') {
        rows.push({ ...event, id: `context-${event.id}`, type: 'context', contextType: 'user-prompt' })
      } else if (event.type === 'assistant' && /<app-context>|<skills_instructions>/.test(event.body || '')) {
        rows.push({ ...event, id: `context-${event.id}`, type: 'context', contextType: 'system-context' })
      } else if (event.type === 'tool') {
        const instructionFiles = (event.files || []).filter((file) => instructionFilePattern.test(file))
        const isAgentPrompt = /multi_agent_v1__(spawn_agent|send_input)/.test(event.tool || '')
        if (isAgentPrompt || instructionFiles.length) {
          rows.push({ ...event, id: `context-${event.id}`, type: 'context', contextType: isAgentPrompt ? 'agent-prompt' : 'instruction-read', files: instructionFiles.length ? instructionFiles : event.files })
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
  const semanticRecords = (session.events || session.eventsList?.length || 0).toLocaleString()
  const contextCounts = contextRows.reduce((counts, event) => ({ ...counts, [event.contextType]: (counts[event.contextType] || 0) + 1 }), {})

  return <section className="panel trace-panel" aria-labelledby="trace-view-title">
    <div className="panel-header trace-panel-header">
      <div>
        <p className="section-label">Conversation and trace</p>
        <h2 id="trace-view-title">Session detail</h2>
        <p className="panel-description">The complete audited rollout: User and Codex turns, every recorded tool call, paired output, file/instruction reference, skill tag, and context marker.</p>
      </div>
      <span className="record-count">{semanticRecords} records</span>
    </div>
    <div className="trace-summary">
      <div><span>Session</span><strong>{session.id}</strong><small>{session.messages} messages · {session.userTurns} user turns</small></div>
      <div><span>Tools</span><strong>{(session.toolCalls || 0).toLocaleString()}</strong><small>{(session.renderedToolRows || session.toolCalls || 0).toLocaleString()} rendered tool rows</small></div>
      <div><span>Capture</span><strong>{session.startedAt}–{session.capturedAt}</strong><small>{(session.rawEvents || 0).toLocaleString()} raw events</small></div>
    </div>
    <SkillInventory events={events} />
    <InstructionInventory events={events} />
    <div className="context-inventory" aria-label="Prompt and context summary">
      <div><span className="section-label">Agent context</span><strong>Prompts & instructions</strong><small>{contextRows.length.toLocaleString()} captured context records · {contextCounts['user-prompt'] || 0} user prompts · {contextCounts['agent-prompt'] || 0} agent prompts · {contextCounts['instruction-read'] || 0} instruction reads · {contextCounts['system-event'] || 0} context markers</small></div>
      <span className="context-inventory-note">Use “Prompts & context” below</span>
    </div>
    <div className="trace-controls" role="group" aria-label="Filter session detail">
      <span>Show</span>
      {filters.map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
      <span className="trace-visible-count">{visibleEvents.length.toLocaleString()} rows · {semanticRecords} semantic records</span>
    </div>
    <div className="trace-stream">
      <div className="stream-intro"><span className="stream-line" /><span>Trace started · {session.startedAt}</span></div>
      {visibleEvents.map((event) => event.type === 'context'
        ? <ContextRow key={event.id} event={event} />
        : event.type === 'tool'
        ? <ToolCallCard key={event.id} event={event} defaultOpen={event.index === '001'} />
        : event.type === 'system'
          ? <SystemEvent key={event.id} event={event} />
          : <ConversationMessage key={event.id} event={event} />)}
      <div className="stream-end"><span>End of captured session · {session.capturedAt}</span><span className="stream-line" /></div>
    </div>
  </section>
}
