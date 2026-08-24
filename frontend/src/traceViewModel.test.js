import { describe, expect, it } from 'vitest'
import { normalizeTraceViewModel } from './traceViewModel'

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
})
