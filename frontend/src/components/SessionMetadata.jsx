function getRuntimeMetadata(session) {
  const sources = [
    session?.runtime_metadata,
    session?.runtimeMetadata,
    session?.metadata?.runtime,
    session?.metadata,
  ].filter((value) => value && typeof value === 'object' && !Array.isArray(value))
  const valueFor = (keys) => {
    for (const source of sources) {
      for (const key of keys) {
        if (source[key] != null && source[key] !== '') return source[key]
      }
    }
    return ''
  }

  return {
    model: valueFor(['model', 'model_name', 'modelName']),
    reasoningEffort: valueFor(['reasoning_effort', 'reasoningEffort', 'effort']),
    permissionMode: valueFor(['permission_mode', 'permissionMode']),
  }
}

function MetadataField({ label, value, mono = true }) {
  const displayValue = value == null || value === '' ? 'Not recorded' : value
  return <div className="session-metadata-field"><span>{label}</span><strong className={mono ? 'metadata-value-mono' : ''}>{displayValue}</strong></div>
}

export default function SessionMetadata({ session }) {
  const metadata = getRuntimeMetadata(session)

  return <section className="session-metadata-panel" aria-labelledby="session-metadata-title">
    <div className="session-metadata-header">
      <div>
        <p className="section-label">Runtime metadata</p>
        <h2 id="session-metadata-title">Recorded execution settings</h2>
        <p>Settings may come from captured events or the Codex session transcript. Missing values show as “Not recorded”.</p>
      </div>
      <span className="record-count">Session data</span>
    </div>
    <div className="session-metadata-grid">
      <MetadataField label="Model" value={metadata.model} />
      <MetadataField label="Permission mode" value={metadata.permissionMode} />
      <MetadataField label="Reasoning effort" value={metadata.reasoningEffort} />
    </div>
  </section>
}
