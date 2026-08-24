import { describe, expect, it } from 'vitest'
import { formatTraceTimestamp, normalizeTraceViewModel } from './traceViewModel'

const apiTrace = {
  schema_version: '1',
  session_id: 'session-api-shaped',
  user_id: 'user-1',
  timeline: [],
  conversation: [
    {
      role: 'user',
      content: 'Review the trace ordering.',
      occurred_at: '2026-08-19T08:00:00Z',
      turn_id: 'turn-1',
      raw: {},
    },
    {
      role: 'assistant',
      content: { plan: ['preserve order', 'show metadata'] },
      occurred_at: '2026-08-19T08:00:02Z',
      turn_id: 'turn-1',
      raw: {},
    },
    {
      role: 'user',
      content: 'Also keep code-shaped content readable.',
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

describe('normalizeTraceViewModel', () => {
  it('keeps API conversation order and marks turn boundaries without changing content', () => {
    const model = normalizeTraceViewModel(apiTrace)

    expect(model.source).toBe('api')
    expect(model.conversation.map((event) => event.body)).toEqual([
      'Review the trace ordering.',
      '{\n  "plan": [\n    "preserve order",\n    "show metadata"\n  ]\n}',
      'Also keep code-shaped content readable.',
    ])
    expect(model.conversation.map((event) => event.turnId)).toEqual(['turn-1', 'turn-1', 'turn-2'])
    expect(model.conversation.map((event) => event.turnBoundary)).toEqual([true, false, true])
    expect(model.conversation[1].contentIsCode).toBe(true)
    expect(model.messageCount).toBe(3)
  })

  it('creates a bounded command preview for shell tools and compact summaries for other tools', () => {
    const model = normalizeTraceViewModel({
      schema_version: '1',
      tool_calls: [
        {
          tool_name: 'Bash',
          input: { command: 'npm --prefix frontend test\nnpm --prefix frontend run build', workdir: 'C:\\workspace' },
          output: 'done',
        },
        {
          tool_name: 'read_file',
          input: { path: 'frontend/src/App.jsx', line: 42 },
          output: 'file contents',
        },
        {
          tool_name: 'shell_command',
          input: null,
          output: null,
        },
      ],
    })

    expect(model.events[0]).toMatchObject({
      tool: 'Bash',
      inputPreviewLabel: 'Command',
      inputPreview: 'npm --prefix frontend test\nnpm --prefix frontend run build',
      input: expect.stringContaining('"command": "npm --prefix frontend test'),
    })
    expect(model.events[1]).toMatchObject({
      tool: 'read_file',
      inputPreviewLabel: 'Input',
      inputPreview: '{"path":"frontend/src/App.jsx","line":42}',
    })
    expect(model.events[2]).toMatchObject({
      inputPreviewLabel: 'Input',
      inputPreview: 'Input not recorded',
      inputPreviewKind: 'missing',
    })
  })

  it('marks missing content and turn metadata as partial evidence', () => {
    const model = normalizeTraceViewModel({
      schema_version: '1',
      conversation: [{ role: 'assistant', content: null, occurred_at: null, turn_id: null }],
    })

    expect(model.partial).toBe(true)
    expect(model.conversation[0]).toMatchObject({
      hasContent: false,
      turnLabel: 'Turn not recorded',
      time: 'Time not recorded',
      partial: true,
    })
  })

  it('treats a missing conversation collection as an empty API conversation', () => {
    const model = normalizeTraceViewModel({ schema_version: '1', summary: { message_count: 0 } })

    expect(model.source).toBe('api')
    expect(model.conversation).toEqual([])
    expect(model.partial).toBe(false)
  })

  it('keeps explicit subagent prompts as provenance-bearing context instead of root chat', () => {
    const model = normalizeTraceViewModel({
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
    })

    expect(model.conversation.map((event) => event.body)).toEqual(['Root prompt'])
    expect(model.contextEvents).toEqual([
      expect.objectContaining({
        body: 'Internal agent prompt',
        contextType: 'agent-prompt',
        provenance: expect.objectContaining({ agentId: 'agent-7', agentType: 'worker' }),
      }),
    ])
  })

  it('keeps raw lifecycle records out of root conversation while retaining audit evidence', () => {
    const model = normalizeTraceViewModel({
      schema_version: '1',
      conversation: [
        {
          role: 'unknown',
          content: 'Session started',
          raw: { hook_event_name: 'SessionStart', source: 'startup' },
        },
      ],
      timeline: [
        { id: 'prompt', hook_event_name: 'UserPromptSubmit', occurred_at: '2026-08-19T08:00:00Z', raw: {} },
        { id: 'pre', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:01Z', raw: {} },
        { id: 'post', hook_event_name: 'PostToolUse', occurred_at: '2026-08-19T08:00:02Z', raw: {} },
      ],
    })

    expect(model.conversation).toEqual([])
    expect(model.contextEvents.map((event) => event.provenance.eventName)).toEqual(['SessionStart'])
    expect(model.events.filter((event) => event.type === 'system').map((event) => event.label)).toEqual([
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
    ])
  })

  it('keeps timeline stream order authoritative when timestamps disagree', () => {
    const model = normalizeTraceViewModel({
      schema_version: '1',
      conversation: [
        {
          event_id: 'prompt-1',
          role: 'user',
          content: 'Run the command.',
          occurred_at: '2026-08-19T10:00:00Z',
          turn_id: 'turn-1',
        },
        {
          event_id: 'stop-1',
          role: 'assistant',
          content: 'The command completed.',
          occurred_at: '2026-08-19T09:00:00Z',
          turn_id: 'turn-1',
        },
      ],
      timeline: [
        { id: 'prompt-1', hook_event_name: 'UserPromptSubmit', occurred_at: '2026-08-19T10:00:00Z' },
        { id: 'pre-1', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T10:01:00Z', tool_call_index: 0 },
        { id: 'stop-1', hook_event_name: 'Stop', occurred_at: '2026-08-19T10:02:00Z' },
      ],
      tool_calls: [
        {
          tool_name: 'Bash',
          input: { command: 'npm test' },
          started_at: '2026-08-19T08:00:00Z',
          completed_at: '2026-08-19T08:01:00Z',
        },
      ],
    })

    expect(model.events.map((event) => event.type)).toEqual(['user', 'tool', 'assistant'])
    expect(model.events.map((event) => event.streamOrder)).toEqual([0, 1, 2])
    expect(model.events[1]).toMatchObject({
      occurredAt: '2026-08-19T10:01:00Z',
      time: formatTraceTimestamp('2026-08-19T10:01:00Z'),
    })
    expect(model.events[2]).toMatchObject({
      occurredAt: '2026-08-19T10:02:00Z',
      time: formatTraceTimestamp('2026-08-19T10:02:00Z'),
    })
  })

  it('projects API skill and file signals by timeline event ID and exposes read counts', () => {
    const model = normalizeTraceViewModel({
      schema_version: '1',
      timeline: [
        { id: 'pre-first', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:01Z', tool_call_index: 0 },
        { id: 'pre-second', hook_event_name: 'PreToolUse', occurred_at: '2026-08-19T08:00:02Z', tool_call_index: 1 },
        { id: 'context-signal', hook_event_name: 'SessionStart', occurred_at: '2026-08-19T08:00:03Z' },
      ],
      tool_calls: [
        { tool_name: 'read_file', input: { path: 'README.md' } },
        { tool_name: 'apply_patch', input: { patch: '*** Update File: src/App.jsx' } },
      ],
      skill_invocations: [
        { name: 'frontend-design', event_id: 'pre-first', confidence: 'explicit' },
        { name: 'review', event_id: 'pre-second', confidence: 'inferred' },
        { name: 'context-skill', event_id: 'context-signal', confidence: 'ambiguous' },
      ],
      files: [
        { path: 'README.md', operation: 'read', event_id: 'pre-first' },
        { path: 'src/App.jsx', operation: 'write', event_id: 'pre-first' },
        { path: 'src/traceViewModel.js', operation: 'read', event_id: 'pre-second' },
        { path: 'AGENTS.md', operation: 'read', event_id: 'context-signal' },
      ],
      summary: { event_count: 3, tool_call_count: 2, skill_invocation_count: 3, file_operation_count: 4, file_read_count: 3 },
    })

    const toolEvents = model.events.filter((event) => event.type === 'tool')
    expect(toolEvents[0]).toMatchObject({
      skills: ['frontend-design'],
      files: ['README.md', 'src/App.jsx'],
      skillRecords: [expect.objectContaining({ eventId: 'pre-first', confidence: 'explicit' })],
      fileRecords: [
        expect.objectContaining({ path: 'README.md', operation: 'read', eventId: 'pre-first' }),
        expect.objectContaining({ path: 'src/App.jsx', operation: 'write', eventId: 'pre-first' }),
      ],
    })
    expect(toolEvents[1]).toMatchObject({
      skills: ['review'],
      files: ['src/traceViewModel.js'],
    })

    expect(model.events.find((event) => event.id === 'context-signal')).toMatchObject({
      skills: ['context-skill'],
      files: ['AGENTS.md'],
    })
    expect(model.skillInvocationCount).toBe(3)
    expect(model.fileOperationCount).toBe(4)
    expect(model.fileReadCount).toBe(3)
    expect(model.signalCounts).toEqual({ skills: 3, files: 4, fileReads: 3 })
  })
})
