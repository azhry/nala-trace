import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TraceView from './TraceView'

const apiTrace = {
  schema_version: '1',
  session_id: 'session-api-shaped',
  user_id: 'user-1',
  timeline: [],
  conversation: [
    {
      role: 'user',
      content: 'First user turn',
      occurred_at: '2026-08-19T08:00:00Z',
      turn_id: 'turn-1',
      raw: {},
    },
    {
      role: 'assistant',
      content: 'Assistant reply with code:\nconst safe = true',
      occurred_at: '2026-08-19T08:00:02Z',
      turn_id: 'turn-1',
      raw: {},
    },
    {
      role: 'user',
      content: '<script>alert("unsafe")</script>',
      occurred_at: '2026-08-19T08:01:00Z',
      turn_id: 'turn-2',
      raw: {},
    },
  ],
  tool_calls: [],
  skill_invocations: [],
  files: [],
  summary: { event_count: 3, message_count: 3, tool_call_count: 0 },
}

describe('TraceView API conversation', () => {
  it('renders the Everything stream in API timeline order across messages and tool calls', () => {
    const trace = {
      schema_version: '1',
      session_id: 'session-timeline-order',
      timeline: [
        { id: 'prompt-1', hook_event_name: 'UserPromptSubmit', occurred_at: '2026-08-19T08:00:00Z', raw: {} },
        { id: 'pre-tool', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:01Z', tool_call_index: 0, raw: {} },
        { id: 'post-tool', hook_event_name: 'PostToolUse', occurred_at: '2026-08-19T08:00:02Z', tool_call_index: 0, raw: {} },
        { id: 'stop-1', hook_event_name: 'Stop', occurred_at: '2026-08-19T08:00:03Z', raw: {} },
        { id: 'prompt-2', hook_event_name: 'UserPromptSubmit', occurred_at: '2026-08-19T08:00:04Z', raw: {} },
      ],
      conversation: [
        {
          role: 'user',
          content: 'First user message',
          occurred_at: '2026-08-19T08:00:00Z',
          turn_id: 'turn-1',
          raw: { hook_event_name: 'UserPromptSubmit' },
        },
        {
          role: 'assistant',
          content: 'Assistant message',
          occurred_at: '2026-08-19T08:00:03Z',
          turn_id: 'turn-1',
          raw: { hook_event_name: 'Stop' },
        },
        {
          role: 'user',
          content: 'Second user message',
          occurred_at: '2026-08-19T08:00:04Z',
          turn_id: 'turn-2',
          raw: { hook_event_name: 'UserPromptSubmit' },
        },
      ],
      tool_calls: [
        {
          tool_use_id: 'tool-1',
          tool_name: 'shell_command',
          input: { command: 'npm test', workdir: 'C:\\workspace' },
          output: 'Tests passed',
          started_at: '2026-08-19T08:00:01Z',
          completed_at: '2026-08-19T08:00:02Z',
          status: 'completed',
          raw: { hook_event_name: 'PreToolUse' },
        },
      ],
      summary: { event_count: 5, message_count: 3, tool_call_count: 1 },
    }

    const { container } = render(<TraceView session={trace} />)
    fireEvent.click(screen.getByRole('button', { name: 'Everything' }))

    const streamRecords = [...container.querySelector('.trace-stream').children]
      .filter((record) => record.matches('.conversation-message, .tool-card'))
    expect(streamRecords.map((record) => record.textContent)).toEqual([
      expect.stringContaining('First user message'),
      expect.stringContaining('shell_command'),
      expect.stringContaining('Assistant message'),
      expect.stringContaining('Second user message'),
    ])

    const chronologicalRecords = [...container.querySelector('.trace-stream').children]
      .filter((record) => record.matches('.conversation-message, .tool-card, .system-event'))
      .map((record) => {
        if (record.matches('.tool-card')) return 'tool:shell_command'
        if (record.matches('.system-event')) return `system:${record.querySelector('strong').textContent}`
        return record.textContent.includes('Assistant message') ? 'assistant' : record.textContent.includes('Second user message') ? 'second user' : 'user'
      })

    expect(chronologicalRecords).toEqual([
      'user',
      'tool:shell_command',
      'system:PostToolUse',
      'assistant',
      'second user',
    ])
  })

  it('renders ordered multi-turn messages with role, timestamp, and turn metadata', () => {
    const { container } = render(<TraceView session={apiTrace} />)

    const messages = [...container.querySelectorAll('.conversation-message')]
    expect(messages.map((message) => message.textContent)).toEqual([
      expect.stringContaining('First user turn'),
      expect.stringContaining('Assistant reply with code:'),
      expect.stringContaining('<script>alert("unsafe")</script>'),
    ])
    expect(messages.map((message) => [...message.classList])).toEqual([
      expect.arrayContaining(['conversation-message', 'user']),
      expect.arrayContaining(['conversation-message', 'assistant']),
      expect.arrayContaining(['conversation-message', 'user']),
    ])
    expect(screen.getAllByRole('separator')).toHaveLength(2)
    expect(screen.getAllByText('turn turn-1')).toHaveLength(2)
    expect(screen.getByText('turn turn-2')).toBeInTheDocument()
    expect(screen.getAllByText(/2026/).length).toBeGreaterThanOrEqual(3)
    expect(container.querySelectorAll('script')).toHaveLength(0)
    expect(container.querySelector('.message-content-code')).toHaveTextContent('const safe = true')
  })

  it('exposes partial and empty conversation states', () => {
    const partialTrace = {
      ...apiTrace,
      conversation: [{ role: 'assistant', content: null, occurred_at: null, turn_id: null }],
    }
    const { rerender } = render(<TraceView session={partialTrace} />)

    expect(screen.getByText('Partial conversation data')).toBeInTheDocument()
    expect(screen.getByText('Content not recorded')).toBeInTheDocument()
    expect(screen.getByText('partial evidence')).toBeInTheDocument()

    rerender(<TraceView session={{ schema_version: '1', conversation: [] }} />)
    expect(screen.getByText('No conversation messages were recorded.')).toBeInTheDocument()
  })

  it.each([
    ['loading', 'Loading trace conversation…'],
    ['missing', 'Session trace not found.'],
    ['error', 'Trace conversation could not be loaded.'],
  ])('renders the %s trace request state', (state, message) => {
    render(<TraceView session={apiTrace} traceState={state} onRetry={vi.fn()} />)

    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it('keeps the missing-trace retry control actionable', () => {
    const onRetry = vi.fn()
    render(<TraceView session={apiTrace} traceState="missing" onRetry={onRetry} />)

    fireEvent.click(screen.getByRole('button', { name: 'Retry request' }))
    expect(onRetry).toHaveBeenCalledExactlyOnceWith()
  })

  it('shows root chat first and keeps an internal agent prompt in Prompts & context', () => {
    const trace = {
      schema_version: '1',
      conversation: [
        {
          role: 'user',
          content: 'Root prompt',
          raw: { hook_event_name: 'UserPromptSubmit', prompt: 'Root prompt' },
        },
        {
          role: 'user',
          content: 'Internal agent prompt',
          raw: {
            hook_event_name: 'UserPromptSubmit',
            prompt: 'Internal agent prompt',
            agent_id: 'agent-7',
            agent_type: 'worker',
          },
        },
      ],
      timeline: [
        { id: 'start', hook_event_name: 'SessionStart', occurred_at: '2026-08-19T08:00:00Z', raw: {} },
      ],
    }

    const { container } = render(<TraceView session={trace} />)

    expect(container.querySelectorAll('.conversation-message')).toHaveLength(1)
    expect(screen.getByText('Root prompt')).toBeInTheDocument()
    expect(screen.getByText('Internal agent prompt')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }))

    expect(screen.queryByText('Internal agent prompt')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Prompts & context' }))

    expect(screen.getByText('Agent prompt')).toBeInTheDocument()
    expect(screen.getByText(/agent-7/)).toBeInTheDocument()
    expect(screen.getByText('Internal agent prompt')).toBeInTheDocument()
    expect(screen.getByText('SessionStart')).toBeInTheDocument()
    expect(container.querySelectorAll('.conversation-message')).toHaveLength(0)
  })

  it('renders a root Stop assistant reply while keeping a provenance-bearing agent reply contextual', () => {
    const trace = {
      schema_version: '1',
      conversation: [
        {
          role: 'user',
          content: 'Root prompt from the session.',
          occurred_at: '2026-08-19T08:00:00Z',
          turn_id: 'turn-1',
          raw: {
            hook_event_name: 'UserPromptSubmit',
            prompt: 'Root prompt from the session.',
          },
        },
        {
          role: 'assistant',
          content: 'Root assistant reply from the session.',
          occurred_at: '2026-08-19T08:00:02Z',
          turn_id: 'turn-1',
          raw: {
            hook_event_name: 'Stop',
            last_assistant_message: 'Root assistant reply from the session.',
          },
        },
        {
          role: 'assistant',
          content: 'Internal worker result.',
          occurred_at: '2026-08-19T08:00:03Z',
          turn_id: 'turn-1',
          raw: {
            hook_event_name: 'SubagentStop',
            last_assistant_message: 'Internal worker result.',
            agent_id: 'agent-7',
            agent_type: 'worker',
          },
        },
      ],
      timeline: [],
    }

    const { container } = render(<TraceView session={trace} />)
    const messages = [...container.querySelectorAll('.conversation-message')]

    expect(messages).toHaveLength(2)
    expect(messages[0]).toHaveTextContent('Root prompt from the session.')
    expect(messages[0]).toHaveClass('user')
    expect(messages[1]).toHaveTextContent('Root assistant reply from the session.')
    expect(messages[1]).toHaveClass('assistant')
    expect(screen.getByText('Internal worker result.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }))

    expect(screen.queryByText('Internal worker result.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Prompts & context' }))

    expect(screen.getByText('Internal worker result.')).toBeInTheDocument()
    expect(screen.getByText(/agent-7/)).toBeInTheDocument()
    expect(container.querySelectorAll('.conversation-message')).toHaveLength(0)
  })

  it('does not render raw lifecycle records as conversation messages', () => {
    const trace = {
      schema_version: '1',
      conversation: [
        { role: 'unknown', content: 'session lifecycle', raw: { hook_event_name: 'SessionStart' } },
      ],
      timeline: [
        { id: 'prompt', hook_event_name: 'UserPromptSubmit', occurred_at: '2026-08-19T08:00:00Z', raw: {} },
        { id: 'pre', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:01Z', raw: {} },
        { id: 'post', hook_event_name: 'PostToolUse', occurred_at: '2026-08-19T08:00:02Z', raw: {} },
      ],
    }

    const { container } = render(<TraceView session={trace} />)

    expect(container.querySelectorAll('.conversation-message')).toHaveLength(0)
    expect(screen.getByText('SessionStart')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Prompts & context' }))

    expect(screen.getByText('SessionStart')).toBeInTheDocument()
    expect(screen.getByText('UserPromptSubmit')).toBeInTheDocument()
    expect(screen.getByText('PreToolUse')).toBeInTheDocument()
    expect(screen.getByText('PostToolUse')).toBeInTheDocument()
  })
})
