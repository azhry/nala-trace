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
  it('renders ordered multi-turn messages with role, timestamp, and turn metadata', () => {
    const { container } = render(<TraceView session={apiTrace} />)

    const messages = [...container.querySelectorAll('.conversation-message')]
    expect(messages.map((message) => message.textContent)).toEqual([
      expect.stringContaining('First user turn'),
      expect.stringContaining('Assistant reply with code:'),
      expect.stringContaining('<script>alert("unsafe")</script>'),
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
})
