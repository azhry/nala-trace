import { describe, expect, it } from 'vitest'
import {
  filterSessionSummaries,
  normalizeSessionSummaries,
  sortSessionSummaries,
} from './sessionSummaries'

const payload = {
  sessions: [
    {
      session_id: 'session-old',
      first_event_at: '2026-08-18T08:00:00Z',
      last_event_at: '2026-08-18T08:05:00Z',
      event_count: 12,
      tool_call_count: 4,
      skill_invocation_count: 1,
      file_operation_count: 2,
    },
    {
      session_id: 'session-new',
      first_event_at: '2026-08-19T08:00:00Z',
      last_event_at: '2026-08-19T08:05:00Z',
      event_count: 20,
      tool_call_count: 4,
      skill_invocation_count: 3,
      file_operation_count: 5,
      evaluation_status: 'attention',
    },
  ],
  limit: 100,
}

describe('session summary adapter', () => {
  it('normalizes the protected SessionSummary envelope into row data', () => {
    const [summary] = normalizeSessionSummaries(payload)

    expect(summary).toMatchObject({
      id: 'session-old',
      title: 'session-old',
      eventCount: 12,
      toolCallCount: 4,
      skillInvocationCount: 1,
      fileOperationCount: 2,
      status: 'captured',
    })
    expect(summary.firstEventTime).toBe(Date.parse('2026-08-18T08:00:00Z'))
  })

  it('sorts by recency and keeps metric ties deterministic', () => {
    const summaries = normalizeSessionSummaries(payload)

    expect(sortSessionSummaries(summaries, 'recent').map(({ id }) => id)).toEqual(['session-new', 'session-old'])
    expect(sortSessionSummaries(summaries, 'tools').map(({ id }) => id)).toEqual(['session-new', 'session-old'])
  })

  it('filters by identifier and documented summary metadata', () => {
    const summaries = normalizeSessionSummaries(payload)

    expect(filterSessionSummaries(summaries, 'session-old').map(({ id }) => id)).toEqual(['session-old'])
    expect(filterSessionSummaries(summaries, 'files 5').map(({ id }) => id)).toEqual(['session-new'])
    expect(filterSessionSummaries(summaries, '').map(({ id }) => id)).toEqual(['session-old', 'session-new'])
    expect(filterSessionSummaries(summaries, 'does-not-exist')).toEqual([])
  })
})
