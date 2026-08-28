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
        <p>Runtime settings may be sourced from captured hook payloads or the bounded Codex transcript. Fields not recorded by either source remain “Not recorded”.</p>
      </div>
      <span className="record-count">session-bound</span>
    </div>
    <div className="session-metadata-grid">
      <MetadataField label="Model" value={metadata.model} />
      <MetadataField label="Permission mode" value={metadata.permissionMode} />
      <MetadataField label="Reasoning effort" value={metadata.reasoningEffort} />
    </div>
    <p className="session-metadata-provenance">Captured hook payloads or bounded Codex transcript · Fields absent from both sources remain “Not recorded”.</p>
  </section>
}
