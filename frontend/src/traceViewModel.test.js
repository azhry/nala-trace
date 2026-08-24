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
})
