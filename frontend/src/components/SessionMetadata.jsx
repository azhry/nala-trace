function getRuntimeMetadata(session) {
  const metadata = session?.runtimeMetadata || session?.metadata?.runtime || session?.metadata || {}
  return {
    model: metadata.model || metadata.modelName,
    provider: metadata.provider || metadata.modelProvider || metadata.model_provider,
    reasoningEffort: metadata.reasoningEffort || metadata.reasoning_effort || metadata.effort,
    contextWindowTokens: metadata.contextWindowTokens || metadata.context_window_tokens || metadata.modelContextWindow || metadata.model_context_window,
    client: metadata.client || metadata.originator,
    clientVersion: metadata.clientVersion || metadata.cliVersion || metadata.cli_version,
    source: metadata.source,
    threadSource: metadata.threadSource || metadata.thread_source,
    recordedFrom: metadata.recordedFrom,
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
  return <div className="session-metadata-field"><span>{label}</span><strong className={mono ? 'metadata-value-mono' : ''}>{value || 'Not recorded'}</strong></div>
}

export default function SessionMetadata({ session }) {
  const metadata = getRuntimeMetadata(session)

  return <section className="session-metadata-panel" aria-labelledby="session-metadata-title">
    <div className="session-metadata-header">
      <div>
        <p className="section-label">Runtime metadata</p>
        <h2 id="session-metadata-title">Recorded execution settings</h2>
        <p>These values were captured with this session and describe the model and runtime configuration used for the rollout.</p>
      </div>
      <span className="record-count">session-bound</span>
    </div>
    <div className="session-metadata-grid">
      <MetadataField label="Model" value={metadata.model} />
      <MetadataField label="Provider" value={metadata.provider} />
      <MetadataField label="Reasoning effort" value={metadata.reasoningEffort} />
      <MetadataField label="Context window" value={formatContextWindow(metadata.contextWindowTokens)} />
      <MetadataField label="Client" value={formatClient(metadata.client, metadata.clientVersion)} />
      <MetadataField label="Host source" value={metadata.source} />
      <MetadataField label="Thread source" value={metadata.threadSource} />
      <MetadataField label="Recorded source" value={metadata.recordedFrom} />
    </div>
    <p className="session-metadata-provenance">{metadata.recordedFrom || 'Recorded session metadata'} · Missing fields remain “Not recorded”.</p>
  </section>
}
