import { useState } from 'react'
import { getInstructionScope, isInstructionFile } from './instructionScope'
import { getToolInputPreview } from '../traceViewModel'

function Tag({ children, tone = 'purple' }) {
  return <span className={`trace-tag ${tone}`}>{children}</span>
}

function FileTag({ file }) {
  const scope = isInstructionFile(file) ? getInstructionScope(file) : null
  return <Tag tone="green"><span>file / {file}</span>{scope && <span className={`instruction-scope-badge ${scope.kind}`}>{scope.shortLabel}</span>}</Tag>
}

export default function ToolCallCard({ event, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const skills = event.skills || []
  const files = event.files || []
  const inputPreview = event.inputPreview
    ? { label: event.inputPreviewLabel || 'Input', text: event.inputPreview }
    : getToolInputPreview(event.tool, event.input)
  const bodyId = `tool-card-body-${event.id || event.index || 'input'}`
  const fullInput = event.input == null || event.input === '' ? 'Input not recorded' : typeof event.input === 'string' ? event.input : JSON.stringify(event.input, null, 2)
  const fullResponse = event.response == null || event.response === '' ? 'Response not recorded' : typeof event.response === 'string' ? event.response : JSON.stringify(event.response, null, 2)

  return (
    <article className={`tool-card ${open ? 'is-open' : ''} ${event.status === 'attention' ? 'has-attention' : ''}`}>
      <button
        type="button"
        className="tool-card-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="tool-card-index">{event.index}</span>
        <span className="tool-card-summary">
          <span className="tool-card-name"><strong>{event.tool}</strong><span>{event.time} · {event.duration}</span></span>
          <span className="tool-card-intent">{event.intent}</span>
          <span className="tool-card-preview"><span className="tool-card-preview-label">{inputPreview.label}</span><code>{inputPreview.text}</code></span>
          <span className="tool-tags">
            <Tag tone="blue">{event.action || 'call'}</Tag>
            {skills.map((skill) => <Tag key={`skill-${skill}`} tone="purple">inferred / {skill}</Tag>)}
            {files.map((file) => <FileTag file={file} key={`file-${file}`} />)}
          </span>
        </span>
        <span className="tool-card-status">{event.status} · record {event.record}<span className="tool-card-chevron" aria-hidden="true">⌄</span></span>
      </button>
      {open && (
        <div className="tool-card-body" id={bodyId}>
          <div className="code-block">
            <div className="code-block-label"><span>tool_input</span><span>JSON</span></div>
            <pre>{fullInput}</pre>
          </div>
          <div className="code-block response-block">
            <div className="code-block-label"><span>tool_response</span><span>{event.responseLabel}</span></div>
            <pre>{fullResponse}</pre>
          </div>
        </div>
      )}
    </article>
  )
}
