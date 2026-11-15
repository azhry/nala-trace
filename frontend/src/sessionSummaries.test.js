import { describe, expect, it } from 'vitest'
import {
  displaySessionTitle,
  filterSessionSummaries,
  normalizeSessionSummaries,
  sortSessionSummaries,
} from './sessionSummaries'

const payload = {
  sessions: [
    {
      session_id: 'session-old',
      title: 'Review the older session',
      safe_title: 'Older review',
      first_event_at: '2026-08-18T08:00:00Z',
      last_event_at: '2026-08-18T08:05:00Z',
      event_count: 12,
      tool_call_count: 4,
      mcp_call_count: 2,
      mcp_servers: ['github', 'linear'],
      skill_invocation_count: 1,
      file_operation_count: 2,
      file_read_count: 3,
      token_usage: { input_tokens: 12, total_tokens: 12 },
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
  it('keeps only an explicitly safe API title and preserves returned summary metadata', () => {
    const [summary] = normalizeSessionSummaries(payload)

    expect(summary).toMatchObject({
      id: 'session-old',
      safeTitle: 'Older review',
      eventCount: 12,
      toolCallCount: 4,
      mcpCallCount: 2,
      mcpServers: ['github', 'linear'],
      skillInvocationCount: 1,
      fileOperationCount: 2,
      fileReadCount: 3,
      tokenUsage: { inputTokens: 12, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 12 },
      status: 'captured',
    })
    expect(summary).not.toHaveProperty('title')
    expect(summary.searchTitle).toBe('Review the older session')
    expect(displaySessionTitle(summary)).toBe('Older review')
    expect(summary.firstEventTime).toBe(Date.parse('2026-08-18T08:00:00Z'))
  })

  it('does not expose the API title when it may contain captured prompt text', () => {
    const [promptFallback, idFallback] = normalizeSessionSummaries({
      sessions: [
        { session_id: 'prompt-session', title: 'Start with the first user prompt' },
        { session_id: 'legacy-session', safe_title: 'Legacy run' },
      ],
    })

    expect(promptFallback).toMatchObject({ id: 'prompt-session', safeTitle: '' })
    expect(idFallback).toMatchObject({ id: 'legacy-session', safeTitle: 'Legacy run' })
    expect(displaySessionTitle(promptFallback)).toBe('Untitled session')
    expect(displaySessionTitle(idFallback)).toBe('Legacy run')
  })

  it('ignores empty or non-string API titles', () => {
    const summaries = normalizeSessionSummaries({
      sessions: [
        { session_id: 'blank-title', title: '   ' },
        { session_id: 'non-string-title', title: 42 },
      ],
    })

    expect(summaries.map(displaySessionTitle)).toEqual(['Untitled session', 'Untitled session'])
  })

  it('keeps captured skill signals when a legacy summary omits the canonical counter', () => {
    const [arraySummary, numericSummary] = normalizeSessionSummaries({
      sessions: [
        { session_id: 'array-skills', skill_invocations: [{ name: 'linear' }, { name: 'diagnose' }] },
        { session_id: 'numeric-skills', skill_invocation_count: 0, skills: 5 },
      ],
    })

    expect(arraySummary.skillInvocationCount).toBe(2)
    expect(numericSummary.skillInvocationCount).toBe(5)
  })

  it('normalizes explicit MCP counts and unique server names without inferring from other fields', () => {
    const summaries = normalizeSessionSummaries({
      sessions: [
        { session_id: 'mcp-session', mcp_call_count: 4, mcp_servers: ['github', 'github', ' linear ', '', 42], title: 'Uses GitHub MCP' },
        { session_id: 'empty-mcp-session', title: 'No MCP data', tool_call_count: 2 },
      ],
    })

    expect(summaries[0]).toMatchObject({ mcpCallCount: 4, mcpServers: ['github', 'linear'] })
    expect(summaries[1]).toMatchObject({ mcpCallCount: 0, mcpServers: [] })
    expect(filterSessionSummaries(summaries, 'linear').map(({ id }) => id)).toEqual(['mcp-session'])
    expect(filterSessionSummaries(summaries, 'mcp 4').map(({ id }) => id)).toEqual(['mcp-session'])
  })

  it('sorts by recency and keeps metric ties deterministic', () => {
    const summaries = normalizeSessionSummaries(payload)

    expect(sortSessionSummaries(summaries, 'recent').map(({ id }) => id)).toEqual(['session-new', 'session-old'])
    expect(sortSessionSummaries(summaries, 'tools').map(({ id }) => id)).toEqual(['session-new', 'session-old'])
  })

  it('filters by identifier and documented summary metadata', () => {
    const summaries = normalizeSessionSummaries(payload)

    expect(filterSessionSummaries(summaries, 'Older review').map(({ id }) => id)).toEqual(['session-old'])
    expect(filterSessionSummaries(summaries, 'Review the older session').map(({ id }) => id)).toEqual(['session-old'])
    expect(filterSessionSummaries(summaries, 'Investigate the new session').map(({ id }) => id)).toEqual(['session-new'])
    expect(filterSessionSummaries(summaries, 'session-old').map(({ id }) => id)).toEqual(['session-old'])
    expect(filterSessionSummaries(summaries, 'files 5').map(({ id }) => id)).toEqual(['session-new'])
    expect(filterSessionSummaries(summaries, 'reads 3').map(({ id }) => id)).toEqual(['session-old'])
    expect(filterSessionSummaries(summaries, '').map(({ id }) => id)).toEqual(['session-old', 'session-new'])
    expect(filterSessionSummaries(summaries, 'does-not-exist')).toEqual([])
  })
})
