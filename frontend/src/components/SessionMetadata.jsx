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
    provider: valueFor(['provider', 'model_provider', 'modelProvider']),
    reasoningEffort: valueFor(['reasoning_effort', 'reasoningEffort', 'effort']),
    contextWindowTokens: valueFor(['context_window_tokens', 'contextWindowTokens', 'model_context_window', 'modelContextWindow']),
    client: valueFor(['client', 'originator']),
    clientVersion: valueFor(['client_version', 'clientVersion', 'cli_version', 'cliVersion']),
    permissionMode: valueFor(['permission_mode', 'permissionMode']),
    source: valueFor(['source']),
    threadSource: valueFor(['thread_source', 'threadSource']),
    recordedFrom: valueFor(['recorded_from', 'recordedFrom']),
  }
}

function formatContextWindow(value) {
  if (value == null || value === '') return 'Not recorded'
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? `${numericValue.toLocaleString('en-US')} tokens` : String(value)
}

function formatClient(client, version) {
  return [client, version].filter(Boolean).join(' · ') || 'Not recorded'
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
        <p>These values come from captured hook payloads. Fields not emitted by the producer remain “Not recorded”.</p>
      </div>
      <span className="record-count">session-bound</span>
    </div>
    <div className="session-metadata-grid">
      <MetadataField label="Model" value={metadata.model} />
      <MetadataField label="Provider" value={metadata.provider} />
      <MetadataField label="Reasoning effort" value={metadata.reasoningEffort} />
      <MetadataField label="Context window" value={formatContextWindow(metadata.contextWindowTokens)} />
      <MetadataField label="Client" value={formatClient(metadata.client, metadata.clientVersion)} />
      <MetadataField label="Permission mode" value={metadata.permissionMode} />
      <MetadataField label="Host source" value={metadata.source} />
      <MetadataField label="Thread source" value={metadata.threadSource} />
      <MetadataField label="Recorded source" value={metadata.recordedFrom} />
    </div>
    <p className="session-metadata-provenance">{metadata.recordedFrom || 'Captured hook payloads'} · Fields absent from the producer remain “Not recorded”.</p>
  </section>
}
