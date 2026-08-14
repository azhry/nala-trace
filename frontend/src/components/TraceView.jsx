import ToolCallCard from './ToolCallCard'

function ConversationMessage({ event }) {
  return (
    <div className={`conversation-message ${event.role}`}>
      <div className="message-meta"><span className="message-avatar">{event.role === 'assistant' ? 'AI' : 'U'}</span><strong>{event.role === 'assistant' ? 'Agent' : 'You'}</strong><span>{event.time}</span></div>
      <p>{event.body}</p>
    </div>
  )
}

export default function TraceView({ session }) {
  return (
    <section className="panel trace-panel" aria-labelledby="trace-view-title">
      <div className="panel-header trace-panel-header">
        <div>
          <p className="section-label">02 / Follow the run</p>
          <h2 id="trace-view-title">Conversation &amp; tool timeline</h2>
          <p className="panel-description">Read what the agent said, then expand each task row to inspect its exact input and response.</p>
        </div>
        <div className="trace-run-state"><span className="pulse-dot" />Live capture</div>
      </div>

      <div className="trace-summary">
        <div><span>Selected run</span><strong>{session.title}</strong><small>{session.id}</small></div>
        <div><span>Outcome</span><strong className={session.status === 'attention' ? 'text-amber' : 'text-green'}>{session.outcome}</strong><small>{session.outcomeNote}</small></div>
        <div><span>Runtime</span><strong>{session.duration}</strong><small>{session.events} events captured</small></div>
      </div>

      <div className="trace-stream">
        <div className="stream-intro"><span className="stream-line" /><span>Trace started · {session.startedAt}</span></div>
        {session.eventsList.map((event) => event.type === 'tool'
          ? <ToolCallCard key={event.id} event={event} defaultOpen={event.index === '03'} />
          : <ConversationMessage key={event.id} event={event} />)}
        <div className="stream-end"><span>End of captured trace</span><span className="stream-line" /></div>
      </div>
    </section>
  )
}
