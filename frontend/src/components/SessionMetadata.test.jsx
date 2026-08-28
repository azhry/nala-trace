import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SessionMetadata from './SessionMetadata'

describe('SessionMetadata', () => {
  it('renders the API runtime_metadata contract using snake_case fields', () => {
    render(<SessionMetadata session={{
      runtime_metadata: {
        model: 'gpt-5',
        provider: 'OpenAI',
        reasoning_effort: 'high',
        context_window_tokens: 200000,
        client: 'Codex',
        client_version: '1.2.3',
        permission_mode: 'workspace-write',
        source: 'hook',
        thread_source: 'desktop',
        recorded_from: 'SessionStart',
      },
    }} />)

    expect(screen.getByText('gpt-5')).toBeInTheDocument()
    expect(screen.getByText('workspace-write')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
    expect(screen.getByText('Runtime settings may be sourced from captured hook payloads or the bounded Codex transcript. Fields not recorded by either source remain “Not recorded”.')).toBeInTheDocument()
    expect(screen.getByText('Captured hook payloads or bounded Codex transcript · Fields absent from both sources remain “Not recorded”.')).toBeInTheDocument()
    expect(document.querySelectorAll('.session-metadata-field')).toHaveLength(3)
    expect(screen.queryByText('Provider')).not.toBeInTheDocument()
    expect(screen.queryByText('Context window')).not.toBeInTheDocument()
    expect(screen.queryByText('Client')).not.toBeInTheDocument()
    expect(screen.queryByText('Host source')).not.toBeInTheDocument()
    expect(screen.queryByText('Thread source')).not.toBeInTheDocument()
    expect(screen.queryByText('Recorded source')).not.toBeInTheDocument()
  })

  it('supports compatible camelCase metadata and preserves Not recorded values', () => {
    const { rerender } = render(<SessionMetadata session={{
      runtimeMetadata: {
        modelName: 'gpt-4.1',
        modelProvider: 'OpenAI',
        reasoningEffort: 'medium',
        contextWindowTokens: 128000,
        client: 'Codex Desktop',
        cliVersion: '2.0.0',
        permissionMode: 'read-only',
        threadSource: 'desktop',
        recordedFrom: 'SessionStart',
      },
    }} />)

    expect(screen.getByText('gpt-4.1')).toBeInTheDocument()
    expect(screen.getByText('read-only')).toBeInTheDocument()

    rerender(<SessionMetadata session={{ runtime_metadata: {} }} />)

    expect(screen.getAllByText('Not recorded')).toHaveLength(3)
    expect(document.querySelectorAll('.session-metadata-field')).toHaveLength(3)
  })
})
