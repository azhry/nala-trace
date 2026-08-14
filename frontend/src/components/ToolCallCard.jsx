import { useState } from 'react'

function Tag({ children, tone = 'purple' }) {
  return <span className={`trace-tag ${tone}`}>{children}</span>
}

export default function ToolCallCard({ event, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const skills = event.skills || []
  const files = event.files || []

  return (
    <article className={`tool-card ${open ? 'is-open' : ''} ${event.status === 'attention' ? 'has-attention' : ''}`}>
      <button
        type="button"
        className="tool-card-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="tool-card-index">{event.index}</span>
        <span className="tool-card-summary">
          <span className="tool-card-name"><strong>{event.tool}</strong><span>{event.time} · {event.duration}</span></span>
          <span className="tool-card-intent">{event.intent}</span>
          <span className="tool-tags">
            <Tag tone="blue">{event.action || 'call'}</Tag>
            {skills.map((skill) => <Tag key={`skill-${skill}`} tone="purple">inferred / {skill}</Tag>)}
            {files.map((file) => <Tag key={`file-${file}`} tone="green">file / {file}</Tag>)}
          </span>
        </span>
        <span className="tool-card-status">{event.status} · record {event.record}<span className="tool-card-chevron" aria-hidden="true">⌄</span></span>
      </button>
      {open && (
        <div className="tool-card-body">
          <div className="code-block">
            <div className="code-block-label"><span>tool_input</span><span>JSON</span></div>
            <pre>{event.input}</pre>
          </div>
          <div className="code-block response-block">
            <div className="code-block-label"><span>tool_response</span><span>{event.responseLabel}</span></div>
            <pre>{event.response}</pre>
          </div>
        </div>
      )}
    </article>
  )
}
