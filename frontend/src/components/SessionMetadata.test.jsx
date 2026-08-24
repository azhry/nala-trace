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
        source: 'hook',
        thread_source: 'desktop',
        recorded_from: 'SessionStart',
      },
    }} />)

    expect(screen.getByText('gpt-5')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
    expect(screen.getByText('200,000 tokens')).toBeInTheDocument()
    expect(screen.getByText('Codex · 1.2.3')).toBeInTheDocument()
    expect(screen.getByText('hook')).toBeInTheDocument()
    expect(screen.getByText('desktop')).toBeInTheDocument()
    expect(screen.getByText('SessionStart')).toBeInTheDocument()
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
        threadSource: 'desktop',
        recordedFrom: 'SessionStart',
      },
    }} />)

    expect(screen.getByText('gpt-4.1')).toBeInTheDocument()
    expect(screen.getByText('Codex Desktop · 2.0.0')).toBeInTheDocument()
    expect(screen.getByText('128,000 tokens')).toBeInTheDocument()

    rerender(<SessionMetadata session={{ runtime_metadata: {} }} />)

    expect(screen.getAllByText('Not recorded')).toHaveLength(8)
  })
})
