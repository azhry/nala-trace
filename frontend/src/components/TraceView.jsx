import { useMemo, useState } from 'react'
import ToolCallCard from './ToolCallCard'

function ConversationMessage({ event }) {
  const isUser = event.role === 'user'
  return <div className={`conversation-message ${isUser ? 'user' : 'assistant'}`}><div className="message-meta"><span className="message-avatar">{isUser ? 'U' : 'AI'}</span><strong>{isUser ? 'User' : 'Codex'}</strong><span>{event.time}</span></div><p>{event.body}</p></div>
}

export default function TraceView({ session }) {
  const [filter, setFilter] = useState('all')
  const visibleEvents = useMemo(() => {
    const events = session.eventsList || []
    return events.filter((event) => filter === 'all' || (filter === 'messages' ? event.type !== 'tool' : event.type === 'tool'))
  }, [session.eventsList, filter])

  return <section className="panel trace-panel" aria-labelledby="trace-view-title"><div className="panel-header trace-panel-header"><div><p className="section-label">Conversation and trace</p><h2 id="trace-view-title">Session detail</h2><p className="panel-description">Actual messages and tool rows from the captured Codex rollout. Expand a tool row to inspect its recorded input and response summary.</p></div><span className="record-count">{session.events.toLocaleString()} records</span></div><div className="trace-summary"><div><span>Session</span><strong>{session.id}</strong><small>{session.messages} messages · {session.userTurns} user turns</small></div><div><span>Tools</span><strong>{session.toolCalls.toLocaleString()}</strong><small>captured operations</small></div><div><span>Capture</span><strong>{session.startedAt}–{session.capturedAt}</strong><small>{session.rawEvents.toLocaleString()} raw events</small></div></div><div className="trace-controls" role="group" aria-label="Filter session detail"><span>Show</span>{[['all', 'Everything'], ['messages', 'Messages'], ['tools', 'Tool calls']].map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}<span className="trace-visible-count">{visibleEvents.length} shown from this browser snapshot</span></div><div className="trace-stream"><div className="stream-intro"><span className="stream-line" /><span>Trace started · {session.startedAt}</span></div>{visibleEvents.map((event) => event.type === 'tool' ? <ToolCallCard key={event.id} event={event} defaultOpen={event.index === '001'} /> : <ConversationMessage key={event.id} event={event} />)}<div className="stream-end"><span>End of captured session · {session.capturedAt}</span><span className="stream-line" /></div></div></section>
}
