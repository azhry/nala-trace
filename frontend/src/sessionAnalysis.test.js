import { describe, expect, it } from 'vitest'
import { normalizeSessionAnalysis } from './sessionAnalysis'

const trace = {
  conversation: [
    { role: 'user', turn_id: 'turn-1' },
    { role: 'assistant', turn_id: 'turn-1' },
    { role: 'user', turn_id: 'turn-2' },
  ],
  tool_calls: [{ tool_name: 'rg' }, { tool_name: 'git' }],
  skill_invocations: [{ name: 'frontend-design' }],
}

const analysis = {
  updated_at: '2026-08-19T08:10:00Z',
  annotation: {
    schema_version: '1',
    source: 'session-annotator',
    turns: [{
      event_id: 'stop-1',
      turn_id: 'turn-1',
      follows_instructions: 'yes',
      performance: 'improved',
      rationale: 'The recorded response followed the requested workflow.',
    }],
    tools: [{
      event_id: 'pre-tool-1',
      tool_use_id: 'tool-1',
      necessary: 'unclear',
      rationale: 'The trace does not establish whether this lookup was required.',
    }],
    skills: [{
      event_id: 'skill-1',
      skill_name: 'frontend-design',
      necessary: 'yes',
      rationale: 'The task changes an existing frontend surface.',
    }],
  },
  evaluation: {
    schema_version: '1',
    source: 'session-evaluator',
    verdict: 'fail',
    critique: 'The result contains a recorded review concern.',
    review_signals: [{
      name: 'instruction drift',
      count: 2,
      severity: 'warning',
      detail: 'Two recorded turns required review.',
    }],
    judge_alignment: {
      status: 'not_aligned',
      human_label: 'fail',
      evaluator_label: 'pass',
      agreement: false,
      dataset: 'golden-set-v1',
    },
    evaluation_ledger: {
      project: 'nala-trace',
      improvements: [{
        path: 'AGENTS.md',
        change: 'Clarify the frontend handoff boundary.',
        reason: 'The review found an ambiguous ownership rule.',
      }],
    },
  },
}

describe('session analysis view model', () => {
  it('normalizes the API contract and calculates evidence coverage without inventing verdicts', () => {
    const model = normalizeSessionAnalysis(analysis, trace)

    expect(model).toMatchObject({
      recorded: true,
      updatedAt: '2026-08-19T08:10:00Z',
      annotation: { recorded: true, source: 'session-annotator' },
      evaluation: { recorded: true, verdict: 'fail', verdictLabel: 'Fail' },
    })
    expect(model.annotation.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'turns', coverageValue: '1 / 2 captured', coverageDetail: '50% of captured evidence annotated' }),
      expect.objectContaining({ key: 'tools', coverageValue: '1 / 2 captured', coverageDetail: '50% of captured evidence annotated' }),
      expect.objectContaining({ key: 'skills', coverageValue: '1 / 1 captured', coverageDetail: '100% of captured evidence annotated' }),
    ]))
    expect(model.annotation.categories[0].breakdowns[0].values).toEqual([
      { value: 'yes', count: 1 },
      { value: 'no', count: 0 },
      { value: 'unclear', count: 0 },
    ])
    expect(model.evaluation.reviewSignals[0]).toMatchObject({ name: 'instruction drift', count: 2, severity: 'warning' })
    expect(model.evaluation.judgeAlignment).toMatchObject({ status: 'not_aligned', label: 'Not aligned', agreement: false })
    expect(model.evaluation.evaluationLedger.improvements[0]).toMatchObject({ path: 'AGENTS.md' })
  })

  it.each([
    ['null analysis', null],
    ['empty analysis', { annotation: null, evaluation: null }],
    ['missing analysis', undefined],
  ])('keeps %s explicitly unrecorded', (_label, value) => {
    const model = normalizeSessionAnalysis(value, { ...trace, summary: { tool_call_count: 9 } })

    expect(model.recorded).toBe(false)
    expect(model.annotation.recorded).toBe(false)
    expect(model.evaluation.recorded).toBe(false)
    expect(model.evaluation.verdict).toBeNull()
    expect(model.evaluation.reviewSignals).toEqual([])
  })

  it('keeps an empty but stored annotation distinct from no analysis', () => {
    const model = normalizeSessionAnalysis({ annotation: { schema_version: '1', source: 'session-annotator', turns: [], tools: [], skills: [] }, evaluation: null }, trace)

    expect(model.recorded).toBe(true)
    expect(model.annotation.categories.every((category) => category.annotatedCount === 0)).toBe(true)
    expect(model.evaluation.recorded).toBe(false)
  })
})
