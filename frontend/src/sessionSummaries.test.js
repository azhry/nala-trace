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
      title: 'Review the older session',
      first_event_at: '2026-08-18T08:00:00Z',
      last_event_at: '2026-08-18T08:05:00Z',
      event_count: 12,
      tool_call_count: 4,
      skill_invocation_count: 1,
      file_operation_count: 2,
    },
    {
      session_id: 'session-new',
      title: 'Investigate the new session',
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
  it('uses the explicit API title as the primary row label', () => {
    const [summary] = normalizeSessionSummaries(payload)

    expect(summary).toMatchObject({
      id: 'session-old',
      title: 'Review the older session',
      eventCount: 12,
      toolCallCount: 4,
      skillInvocationCount: 1,
      fileOperationCount: 2,
      status: 'captured',
    })
    expect(summary.firstEventTime).toBe(Date.parse('2026-08-18T08:00:00Z'))
  })

  it('preserves the adapter-provided prompt fallback and uses the ID when title is absent', () => {
    const [promptFallback, idFallback] = normalizeSessionSummaries({
      sessions: [
        { session_id: 'prompt-session', title: 'Start with the first user prompt' },
        { session_id: 'legacy-session' },
      ],
    })

    expect(promptFallback).toMatchObject({ id: 'prompt-session', title: 'Start with the first user prompt' })
    expect(idFallback).toMatchObject({ id: 'legacy-session', title: 'legacy-session' })
  })

  it('ignores empty or non-string API titles', () => {
    const summaries = normalizeSessionSummaries({
      sessions: [
        { session_id: 'blank-title', title: '   ' },
        { session_id: 'non-string-title', title: 42 },
      ],
    })

    expect(summaries.map(({ title }) => title)).toEqual(['blank-title', 'non-string-title'])
  })

  it('sorts by recency and keeps metric ties deterministic', () => {
    const summaries = normalizeSessionSummaries(payload)

    expect(sortSessionSummaries(summaries, 'recent').map(({ id }) => id)).toEqual(['session-new', 'session-old'])
    expect(sortSessionSummaries(summaries, 'tools').map(({ id }) => id)).toEqual(['session-new', 'session-old'])
  })

  it('filters by identifier and documented summary metadata', () => {
    const summaries = normalizeSessionSummaries(payload)

    expect(filterSessionSummaries(summaries, 'investigate the new').map(({ id }) => id)).toEqual(['session-new'])
    expect(filterSessionSummaries(summaries, 'session-old').map(({ id }) => id)).toEqual(['session-old'])
    expect(filterSessionSummaries(summaries, 'files 5').map(({ id }) => id)).toEqual(['session-new'])
    expect(filterSessionSummaries(summaries, '').map(({ id }) => id)).toEqual(['session-old', 'session-new'])
    expect(filterSessionSummaries(summaries, 'does-not-exist')).toEqual([])
  })
})
