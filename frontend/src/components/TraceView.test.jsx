import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TraceView from './TraceView'

const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

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

function createLargeTrace(size = 125) {
  const timeline = Array.from({ length: size }, (_, index) => ({
    id: `pre-read-${index}`,
    hook_event_name: 'PreToolUse',
    occurred_at: `2026-08-19T08:00:${String(index % 60).padStart(2, '0')}Z`,
    tool_call_index: index,
  }))
  const tool_calls = Array.from({ length: size }, (_, index) => ({
    tool_use_id: `tool-use-${index}`,
    tool_name: 'shell_command',
    input: { command: `read trace fixture ${index}` },
    output: `completed ${index}`,
    started_at: `2026-08-19T08:00:${String(index % 60).padStart(2, '0')}Z`,
    completed_at: `2026-08-19T08:00:${String(index % 60).padStart(2, '0')}Z`,
    status: 'completed',
  }))
  return {
    schema_version: '1',
    session_id: `large-session-${size}`,
    timeline,
    conversation: [],
    tool_calls,
    skill_invocations: [],
    files: [{ path: '.agents/workflows/deep.md', operation: 'read', event_id: `pre-read-${size - 1}` }],
    summary: { event_count: size * 2, message_count: 0, tool_call_count: size },
  }
}

describe('TraceView API conversation', () => {
  it('uses the normalized skill invocation count in the first summary tile', () => {
    const trace = {
      ...apiTrace,
      skill_invocations: [
        { name: 'frontend-design' },
        { name: 'diagnose' },
      ],
      summary: { ...apiTrace.summary, skill_invocation_count: 99 },
    }

    const { container } = render(<TraceView session={trace} />)
    const tiles = [...container.querySelectorAll('.trace-summary > div')]

    expect(tiles).toHaveLength(4)
    expect(tiles.map((tile) => tile.querySelector('span')?.textContent)).toEqual([
      'Skill invocations',
      'Tools',
      'MCP',
      'Capture',
    ])
    expect(within(tiles[0]).getByText('2')).toBeInTheDocument()
    expect(within(tiles[0]).getByText('captured invocation records')).toBeInTheDocument()
    expect(within(tiles[0]).queryByText('session-api-shaped')).not.toBeInTheDocument()
  })

  it('renders MCP usage and an explicit empty state from the API summary', () => {
    const { rerender } = render(<TraceView session={{ ...apiTrace, summary: { ...apiTrace.summary, mcp_call_count: 4, mcp_servers: ['github', 'linear'] } }} />)

    expect(screen.getByText('4 calls')).toBeInTheDocument()
    expect(screen.getByText('2 distinct servers')).toBeInTheDocument()
    expect(screen.getByText('github')).toBeInTheDocument()
    expect(screen.getByText('linear')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'MCP usage summary' })).toBeInTheDocument()

    rerender(<TraceView session={{ ...apiTrace, summary: { ...apiTrace.summary, mcp_call_count: 0, mcp_servers: [] } }} />)

    expect(screen.getByText('No MCP calls or MCP servers were recorded.')).toBeInTheDocument()
  })

  it('renders session token usage and per-event usage from the API detail response', () => {
    render(<TraceView session={{
      ...apiTrace,
      timeline: [{
        id: 'stop-usage',
        hook_event_name: 'Stop',
        occurred_at: '2026-08-19T08:00:02Z',
        token_usage: {
          input_tokens: 100,
          cached_input_tokens: 20,
          output_tokens: 40,
          reasoning_tokens: 5,
          total_tokens: 140,
          cost_usd: 0.0012,
        },
      }],
      conversation: [{
        event_id: 'stop-usage',
        role: 'assistant',
        content: 'Completed with usage.',
        occurred_at: '2026-08-19T08:00:02Z',
        turn_id: 'turn-1',
      }],
      summary: {
        ...apiTrace.summary,
        token_usage: {
          input_tokens: 100,
          cached_input_tokens: 20,
          output_tokens: 40,
          reasoning_tokens: 5,
          total_tokens: 140,
          cost_usd: 0.0012,
        },
      },
    }} />)

    expect(screen.getByRole('region', { name: 'Token usage summary' })).toBeInTheDocument()
    expect(screen.getByText('Token usage')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('140')).toBeInTheDocument()
    expect(screen.getByText('$0.0012')).toBeInTheDocument()
    expect(screen.getByLabelText('Event token usage: 140 total tokens, $0.0012')).toBeInTheDocument()
  })

  it('explains when a session has no recorded token usage', () => {
    render(<TraceView session={apiTrace} />)

    expect(screen.getByRole('region', { name: 'Token usage summary' })).toBeInTheDocument()
    expect(screen.getByText('No token usage was recorded for this session.')).toBeInTheDocument()
  })

  it('bounds the initially mounted stream and loads more rows on demand', () => {
    const { container } = render(<TraceView session={createLargeTrace()} />)

    expect(container.querySelectorAll('.tool-card')).toHaveLength(60)
    expect(screen.getByText('Showing 60 of 125 rows')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load more rows' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load more rows' }))

    expect(container.querySelectorAll('.tool-card')).toHaveLength(120)
    expect(screen.getByText('Showing 120 of 125 rows')).toBeInTheDocument()
  })

  it('renders and focuses a deep evidence match before scrolling to it', () => {
    const { container } = render(<TraceView session={createLargeTrace()} />)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      expect(container.querySelector('[data-trace-event-id="tool-124"]')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Locate captured instruction source .agents/workflows/deep.md in the trace' }))

      const deepEvent = container.querySelector('[data-trace-event-id="tool-124"]')
      expect(deepEvent).toBeInTheDocument()
      expect(deepEvent).toHaveAttribute('data-trace-event-selected', 'true')
      expect(deepEvent).toHaveAttribute('data-trace-event-active', 'true')
      expect(document.activeElement).toBe(deepEvent)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
      expect(screen.getByText('Showing 125 of 125 rows')).toBeInTheDocument()
    } finally {
      if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView
      else delete HTMLElement.prototype.scrollIntoView
    }
  })

  it('resets the mounted window when the filter and selected session change', () => {
    const firstTrace = createLargeTrace()
    const secondTrace = { ...createLargeTrace(), session_id: 'large-session-2' }
    const { container, rerender } = render(<TraceView session={firstTrace} />)

    fireEvent.click(screen.getByRole('button', { name: 'Load more rows' }))
    expect(container.querySelectorAll('.tool-card')).toHaveLength(120)

    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }))
    expect(screen.getByText('Showing 0 of 0 rows')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Everything' }))
    expect(container.querySelectorAll('.tool-card')).toHaveLength(60)

    rerender(<TraceView session={secondTrace} />)
    expect(container.querySelectorAll('.tool-card')).toHaveLength(60)
  })

  it('renders the Everything stream in API timeline order across messages and tool calls', () => {
    const trace = {
      schema_version: '1',
      session_id: 'session-timeline-order',
      timeline: [
        { id: 'prompt-1', hook_event_name: 'UserPromptSubmit', occurred_at: '2026-08-19T08:00:00Z', raw: {} },
        { id: 'pre-tool', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:01Z', tool_call_index: 0, raw: {} },
        { id: 'post-tool', hook_event_name: 'PostToolUse', occurred_at: '2026-08-19T08:00:02Z', tool_call_index: 0, raw: {} },
        { id: 'unmatched-post-tool', hook_event_name: 'PostToolUse', occurred_at: '2026-08-19T08:00:02.500Z', tool_call_index: 99, raw: {} },
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

    expect(screen.getAllByText('PostToolUse')).toHaveLength(1)
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
    if (state === 'loading') {
      const loadingStatus = screen.getByRole('status')
      expect(loadingStatus).toHaveAttribute('aria-busy', 'true')
      expect(loadingStatus).toHaveClass('trace-loading-panel')
      expect(loadingStatus.querySelector('.trace-loader-mark')).toBeInTheDocument()
      expect(loadingStatus.querySelector('.trace-loading-skeletons')).toBeInTheDocument()
    }
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

  it('counts normalized API file reads, including only actual SKILL.md reads', () => {
    const trace = {
      schema_version: '1',
      timeline: [
        { id: 'pre-read', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:00Z', tool_call_index: 0 },
      ],
      tool_calls: [
        { tool_name: 'shell_command', input: { command: 'read files' } },
      ],
      skill_invocations: [],
      files: [
        { path: '.agents/skills/frontend-design/SKILL.md', operation: 'read', event_id: 'pre-read' },
        { path: '.agents/skills/other/SKILL.md', operation: 'write', event_id: 'pre-read' },
        { path: '.agents/workflows/frontend.md', action: 'read', event_id: 'pre-read' },
      ],
    }

    render(<TraceView session={trace} />)

    expect(screen.getByText(/1 SKILL\.md read across 1 unique skill document · 1 inferred tag occurrence across 1 inferred label/)).toBeInTheDocument()
    expect(screen.getByText(/2 read records · 3 unique instruction sources · 2 global · 1 local project/)).toBeInTheDocument()
    expect(screen.getByText('No captured skill evidence or skill invocation was recorded in the source audit; inferred tags are shown separately from document reads.')).toBeInTheDocument()
  })

  it('counts skill documents across normalized, user-level, and plugin skill paths', () => {
    const trace = {
      schema_version: '1',
      timeline: [],
      tool_calls: [],
      skill_invocations: [],
      files: [
        { path: '.agents//skills//linear//SKILL.md', operation: 'read' },
        { path: 'C:\\Users\\Lyrid\\.agents\\skills\\diagnose\\SKILL.md', operation: 'read' },
        { path: '.codex/plugins/cache/browser/skills/control-in-app-browser/SKILL.md', operation: 'read' },
        { path: '.agents/skills/other/SKILL.md', operation: 'write' },
      ],
    }

    render(<TraceView session={trace} />)

    expect(screen.getByText(/3 SKILL\.md reads across 3 unique skill documents · 3 inferred tag occurrences across 3 inferred labels/)).toBeInTheDocument()
    expect(screen.getByText('skill / linear')).toBeInTheDocument()
    expect(screen.getByText('skill / diagnose')).toBeInTheDocument()
    expect(screen.getByText('skill / control-in-app-browser')).toBeInTheDocument()
  })

  it('locates a referenced instruction source in its captured timeline event', () => {
    const trace = {
      schema_version: '1',
      timeline: [
        { id: 'pre-read', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:00Z', tool_call_index: 0 },
      ],
      tool_calls: [{ tool_name: 'shell_command', input: { command: 'read frontend workflow' } }],
      files: [
        { path: '.agents/workflows/frontend.md', operation: 'read', event_id: 'pre-read' },
      ],
    }

    const { container } = render(<TraceView session={trace} />)

    fireEvent.click(screen.getByRole('button', { name: 'Locate captured instruction source .agents/workflows/frontend.md in the trace' }))

    expect(screen.getByText('.agents/workflows/frontend.md')).toBeInTheDocument()
    expect(screen.getByText(/1 matching timeline event selected/)).toBeInTheDocument()
    expect(container.querySelector('[data-trace-event-id="tool-0"]')).toHaveAttribute('data-trace-event-selected', 'true')
    expect(container.querySelector('[data-trace-event-id="tool-0"]')).toHaveClass('is-evidence-selected')
  })

  it('gives instruction file tags a dark surface instead of a native white button background', () => {
    const trace = {
      schema_version: '1',
      timeline: [
        { id: 'pre-read', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:00Z', tool_call_index: 0 },
      ],
      tool_calls: [
        { tool_name: 'shell_command', input: { command: 'read frontend workflow' }, output: 'instruction content' },
      ],
      files: [
        { path: '.agents/workflows/frontend.md', operation: 'read', event_id: 'pre-read' },
      ],
    }

    render(<TraceView session={trace} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prompts & context' }))

    const fileTag = screen.getAllByRole('button', { name: 'Locate captured file .agents/workflows/frontend.md in the trace' })[0]
    expect(fileTag).toHaveClass('context-tag', 'file')
    expect(styles).toMatch(/button\.context-tag\.file\s*\{[^}]*background:\s*rgba\(34,\s*42,\s*52,\s*\.52\);[^}]*\}/)
  })

  it('keeps four matching evidence events highlighted and navigates the active match', () => {
    const trace = {
      schema_version: '1',
      timeline: [
        { id: 'pre-read-1', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:00Z', tool_call_index: 0 },
        { id: 'pre-read-2', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:01Z', tool_call_index: 1 },
        { id: 'pre-read-3', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:02Z', tool_call_index: 2 },
        { id: 'pre-read-4', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:03Z', tool_call_index: 3 },
      ],
      tool_calls: [
        { tool_name: 'shell_command', input: { command: 'read frontend workflow once' } },
        { tool_name: 'shell_command', input: { command: 'read frontend workflow twice' } },
        { tool_name: 'shell_command', input: { command: 'read frontend workflow three times' } },
        { tool_name: 'shell_command', input: { command: 'read frontend workflow four times' } },
      ],
      files: [
        { path: '.agents/workflows/frontend.md', operation: 'read', event_id: 'pre-read-1' },
        { path: '.agents/workflows/frontend.md', operation: 'read', event_id: 'pre-read-2' },
        { path: '.agents/workflows/frontend.md', operation: 'read', event_id: 'pre-read-3' },
        { path: '.agents/workflows/frontend.md', operation: 'read', event_id: 'pre-read-4' },
      ],
    }
    const { container } = render(<TraceView session={trace} />)
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Locate captured instruction source .agents/workflows/frontend.md in the trace' }))

      expect(screen.getByText('Match 1 of 4')).toBeInTheDocument()
      const selectionNotice = container.querySelector('.evidence-selection-notice')
      const matchDock = container.querySelector('.evidence-match-dock')
      expect(matchDock).toBeInTheDocument()
      expect(matchDock).toHaveAttribute('role', 'group')
      expect(matchDock).toHaveAttribute('aria-label', 'Evidence match navigation')
      expect(matchDock).toContainElement(screen.getByText('Match 1 of 4'))
      expect(matchDock).toContainElement(screen.getByRole('button', { name: 'Previous matching event' }))
      expect(matchDock).toContainElement(screen.getByRole('button', { name: 'Next matching event' }))
      expect(matchDock).toContainElement(screen.getByRole('button', { name: 'Clear selection' }))
      expect(selectionNotice).not.toContainElement(matchDock)
      expect(selectionNotice.querySelector('.evidence-match-navigation')).toBeNull()
      expect(container.querySelectorAll('[data-trace-event-selected="true"]')).toHaveLength(4)
      const firstMatch = container.querySelector('[data-trace-event-id="tool-0"]')
      const secondMatch = container.querySelector('[data-trace-event-id="tool-1"]')
      const thirdMatch = container.querySelector('[data-trace-event-id="tool-2"]')
      const fourthMatch = container.querySelector('[data-trace-event-id="tool-3"]')
      expect(firstMatch).toHaveAttribute('data-trace-event-active', 'true')
      expect(secondMatch).toHaveAttribute('data-trace-event-selected', 'true')
      expect(thirdMatch).toHaveAttribute('data-trace-event-selected', 'true')
      expect(fourthMatch).toHaveAttribute('data-trace-event-selected', 'true')
      expect(document.activeElement).toBe(firstMatch)
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
      expect(screen.getByRole('button', { name: 'Previous matching event' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Next matching event' })).toBeEnabled()

      fireEvent.click(screen.getByRole('button', { name: 'Next matching event' }))

      expect(screen.getByText('Match 2 of 4')).toBeInTheDocument()
      expect(firstMatch).toHaveAttribute('data-trace-event-selected', 'true')
      expect(firstMatch).toHaveAttribute('data-trace-event-active', 'false')
      expect(secondMatch).toHaveAttribute('data-trace-event-active', 'true')
      expect(document.activeElement).toBe(secondMatch)
      expect(scrollIntoView).toHaveBeenCalledTimes(2)

      fireEvent.click(screen.getByRole('button', { name: 'Next matching event' }))
      fireEvent.click(screen.getByRole('button', { name: 'Next matching event' }))

      expect(screen.getByText('Match 4 of 4')).toBeInTheDocument()
      expect(thirdMatch).toHaveAttribute('data-trace-event-selected', 'true')
      expect(thirdMatch).toHaveAttribute('data-trace-event-active', 'false')
      expect(fourthMatch).toHaveAttribute('data-trace-event-active', 'true')
      expect(document.activeElement).toBe(fourthMatch)
      expect(scrollIntoView).toHaveBeenCalledTimes(4)
      expect(screen.getByRole('button', { name: 'Next matching event' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Previous matching event' })).toBeEnabled()

      fireEvent.click(screen.getByRole('button', { name: 'Previous matching event' }))

      expect(screen.getByText('Match 3 of 4')).toBeInTheDocument()
      expect(thirdMatch).toHaveAttribute('data-trace-event-active', 'true')
      expect(fourthMatch).toHaveAttribute('data-trace-event-selected', 'true')
      expect(document.activeElement).toBe(thirdMatch)
      expect(scrollIntoView).toHaveBeenCalledTimes(5)
    } finally {
      if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView
      else delete HTMLElement.prototype.scrollIntoView
    }
  })

  it('infers a skill label from a read of any file inside a skill directory', () => {
    const trace = {
      schema_version: '1',
      timeline: [
        { id: 'pre-read', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:00Z', tool_call_index: 0 },
      ],
      tool_calls: [{ tool_name: 'shell_command', input: { command: 'read script' } }],
      skill_invocations: [],
      files: [
        { path: '.agents/skills/github/scripts/gh_preflight.ps1', operation: 'read', event_id: 'pre-read' },
      ],
    }

    render(<TraceView session={trace} />)

    expect(screen.getByText(/1 inferred tag occurrence across 1 inferred label/)).toBeInTheDocument()
    expect(screen.getByText('inferred / github')).toBeInTheDocument()
    expect(screen.getByText('No captured skill evidence or skill invocation was recorded in the source audit; inferred tags are shown separately from document reads.')).toBeInTheDocument()
  })

  it('describes explicit and inferred skill invocations as captured skill evidence', () => {
    const trace = {
      schema_version: '1',
      timeline: [],
      tool_calls: [],
      skill_invocations: [
        { name: 'frontend-design', confidence: 'explicit', event_id: 'pre-skill' },
        { name: 'frontend-design', confidence: 'inferred', event_id: 'pre-read', raw: { path: '.agents/skills/frontend-design/SKILL.md' } },
      ],
      files: [],
    }

    render(<TraceView session={trace} />)

    expect(screen.getByText('2 captured skill evidence records were recorded as skill invocations; inferred tags are shown separately from document reads.')).toBeInTheDocument()
    expect(screen.queryByText(/literal skill-invocation/)).not.toBeInTheDocument()
  })

  it('counts session-level file evidence when its event ID is not projected onto the timeline', () => {
    const trace = {
      schema_version: '1',
      timeline: [
        { id: 'different-event', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:00Z', tool_call_index: 0 },
      ],
      tool_calls: [{ tool_name: 'shell_command', input: { command: 'unmatched event' } }],
      skill_invocations: [],
      files: [
        { path: '.agents/skills/frontend-design/SKILL.md', operation: 'read', event_id: 'missing-event' },
        { path: '.agents/workflows/frontend.md', operation: 'read', event_id: 'missing-event' },
      ],
    }

    const { container } = render(<TraceView session={trace} />)

    expect(screen.getByText(/1 SKILL\.md read across 1 unique skill document · 1 inferred tag occurrence across 1 inferred label/)).toBeInTheDocument()
    expect(screen.getByText(/2 read records · 2 unique instruction sources/)).toBeInTheDocument()
    expect(screen.getByText('inferred / frontend-design')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Locate captured instruction source .agents/workflows/frontend.md in the trace' }))

    expect(screen.getByText(/No matching timeline event was found\./)).toBeInTheDocument()
    expect(container.querySelector('.evidence-selection-notice')).toHaveTextContent(/no event was invented/)
  })
})
