import { useMemo, useState } from 'react'
import ToolCallCard from './ToolCallCard'

const filters = [
  ['all', 'Everything'],
  ['conversation', 'Conversation'],
  ['tools', 'Tool calls'],
  ['system', 'Context'],
]
const EMPTY_EVENTS = []

function SkillTags({ skills = [] }) {
  if (!skills.length) return null
  return <span className="message-tags">{skills.map((skill) => <span className="message-tag" key={skill}>skill / {skill}</span>)}</span>
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

function SkillInventory({ events }) {
  const skillCounts = useMemo(() => {
    const counts = new Map()
    events.forEach((event) => (event.skills || []).forEach((skill) => counts.set(skill, (counts.get(skill) || 0) + 1)))
    return [...counts.entries()].sort(([, left], [, right]) => right - left)
  }, [events])
  const invocationCount = skillCounts.reduce((total, [, count]) => total + count, 0)

  return <div className="skill-inventory" aria-label="Skill invocation summary">
    <div className="skill-inventory-heading">
      <div><span className="section-label">Observed skills</span><strong>Skill invocations</strong><small>{invocationCount.toLocaleString()} invocations · {skillCounts.length} unique skills</small></div>
      <span className="record-count">from tool trace</span>
    </div>
    {skillCounts.length ? <div className="skill-inventory-list">{skillCounts.map(([skill, count]) => <span className="skill-inventory-item" key={skill}><span>skill / {skill}</span><strong>{count.toLocaleString()}</strong></span>)}</div> : <p className="skill-inventory-empty">No skill invocations were recorded in this session.</p>}
  </div>
}

export default function TraceView({ session }) {
  const [filter, setFilter] = useState('all')
  const events = session.eventsList || EMPTY_EVENTS
  const visibleEvents = useMemo(() => {
    return events.filter((event) => {
      if (filter === 'all') return true
      if (filter === 'conversation') return event.type === 'user' || event.type === 'assistant'
      if (filter === 'tools') return event.type === 'tool'
      return event.type === 'system'
    })
  }, [events, filter])
  const semanticRecords = (session.events || session.eventsList?.length || 0).toLocaleString()

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
    <div className="trace-controls" role="group" aria-label="Filter session detail">
      <span>Show</span>
      {filters.map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
      <span className="trace-visible-count">{visibleEvents.length.toLocaleString()} rows · {semanticRecords} semantic records</span>
    </div>
    <div className="trace-stream">
      <div className="stream-intro"><span className="stream-line" /><span>Trace started · {session.startedAt}</span></div>
      {visibleEvents.map((event) => event.type === 'tool'
        ? <ToolCallCard key={event.id} event={event} defaultOpen={event.index === '001'} />
        : event.type === 'system'
          ? <SystemEvent key={event.id} event={event} />
          : <ConversationMessage key={event.id} event={event} />)}
      <div className="stream-end"><span>End of captured session · {session.capturedAt}</span><span className="stream-line" /></div>
    </div>
  </section>
}
