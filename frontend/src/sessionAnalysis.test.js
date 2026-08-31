import { describe, expect, it } from 'vitest'
import { normalizeSessionAnalysis } from './sessionAnalysis'

const trace = {
  conversation: [
    { event_id: 'prompt-1', role: 'user', content: 'Please inspect the repository.', turn_id: 'turn-1' },
    { event_id: 'stop-1', role: 'assistant', content: 'The assistant completed the requested inspection.', turn_id: 'turn-1' },
    { event_id: 'prompt-2', role: 'user', content: 'Summarize the result.', turn_id: 'turn-2' },
  ],
  tool_calls: [{ tool_use_id: 'tool-1', tool_name: 'rg', input: { cmd: 'rg --files' } }, { tool_name: 'git' }],
  timeline: [{ id: 'stop-1', hook_event_name: 'Stop' }],
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
      name: 'unmatched_tool_hook_pairs',
      count: 2,
      severity: 'warning',
      detail: 'Unmatched event: ObjectID("stop-1").',
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
      expect.objectContaining({ key: 'turns', coverageValue: '1 labeled / 2 total', coverageDetail: '50% labeled' }),
      expect.objectContaining({ key: 'tools', coverageValue: '1 labeled / 2 total', coverageDetail: '50% labeled' }),
      expect.objectContaining({ key: 'skills', coverageValue: '1 labeled / 1 total', coverageDetail: '100% labeled' }),
    ]))
    expect(model.annotation.performanceSummary).toEqual([
      { value: 'improved', count: 1, turnIds: ['turn-1'], turns: [{ id: 'turn-1', role: 'assistant', preview: 'The assistant completed the requested inspection.' }] },
      { value: 'neutral', count: 0, turnIds: [], turns: [] },
      { value: 'worsened', count: 0, turnIds: [], turns: [] },
      { value: 'unclear', count: 0, turnIds: [], turns: [] },
    ])
    expect(model.annotation.categories.find((category) => category.key === 'turns').records[0]).toMatchObject({
      turnId: 'turn-1',
      turnRole: 'assistant',
      turnPreview: 'The assistant completed the requested inspection.',
    })
    expect(model.annotation.categories.find((category) => category.key === 'tools').records[0]).toMatchObject({
      toolName: 'rg',
      toolUseId: 'tool-1',
      inputPreview: expect.stringContaining('rg --files'),
    })
    expect(model.annotation.categories[0].breakdowns[0].values).toEqual([
      { value: 'yes', count: 1 },
      { value: 'no', count: 0 },
      { value: 'unclear', count: 0 },
    ])
    expect(model.evaluation.reviewSignals[0]).toMatchObject({
      name: 'Unmatched tool hook pairs',
      count: 2,
      severity: 'warning',
      severityMeaning: 'Review concern',
      detail: expect.stringContaining('Codex response'),
    })
    expect(model.evaluation.judgeAlignment).toMatchObject({ status: 'not_aligned', label: 'Not aligned', agreement: false })
    expect(model.evaluation.evaluationLedger).toMatchObject({ project: 'nala-trace', projectContextOnly: true })
    expect(model.evaluation.evaluationLedger.improvements[0]).toMatchObject({
      path: 'AGENTS.md',
      target: 'AGENTS.md',
      targetKind: 'instruction',
      targetLabel: 'Agent instructions',
      targetValid: true,
    })
    expect(model.evaluation.evaluationLedger.legacyImprovements).toEqual([])
  })

  it('keeps agent behavior and instruction Markdown targets in the actionable ledger', () => {
    const model = normalizeSessionAnalysis({
      evaluation: {
        evaluation_ledger: {
          project: 'nala-trace',
          improvements: [
            { path: 'agent behavior', change: 'Use a bounded verification loop.', reason: 'The agent stopped before checking the rendered result.' },
            { path: '.agents/skills/session-evaluator/references/result-schema.md', change: 'State the target boundary.', reason: 'The evaluation had no safe destination for its next step.' },
            { path: '.agents/workflows/frontend.md', change: 'Require the mobile check.', reason: 'The responsive flow was not observed.' },
          ],
        },
      },
    })

    expect(model.evaluation.evaluationLedger.improvements).toEqual([
      expect.objectContaining({ target: 'Agent behavior', targetKind: 'agent', targetLabel: 'Agent behavior', targetValid: true }),
      expect.objectContaining({ target: '.agents/skills/session-evaluator/references/result-schema.md', targetKind: 'skill', targetLabel: 'Skill instructions', targetValid: true }),
      expect.objectContaining({ target: '.agents/workflows/frontend.md', targetKind: 'workflow', targetLabel: 'Workflow instructions', targetValid: true }),
    ])
    expect(model.evaluation.evaluationLedger.legacyImprovements).toEqual([])
  })

  it('moves legacy project-source targets out of the actionable ledger', () => {
    const model = normalizeSessionAnalysis({
      evaluation: {
        evaluation_ledger: {
          project: 'nala-trace',
          improvements: [{ path: 'frontend/src/App.jsx', change: 'Refactor the component.', reason: 'The page is hard to scan.' }],
        },
      },
    })

    expect(model.evaluation.evaluationLedger.improvements).toEqual([])
    expect(model.evaluation.evaluationLedger.legacyImprovements).toEqual([
      expect.objectContaining({
        path: 'frontend/src/App.jsx',
        target: 'frontend/src/App.jsx',
        targetKind: 'legacy_out_of_scope',
        targetLabel: 'Out of scope — project source',
        targetValid: false,
        outOfScopeReason: expect.stringContaining('shown for traceability only'),
      }),
    ])
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

  it('materializes individual unmatched-tool occurrences from annotation and trace evidence', () => {
    const model = normalizeSessionAnalysis({
      annotation: {
        schema_version: '1',
        source: 'session-annotator',
        turns: [],
        tools: [
          { event_id: 'pre-tool-1', tool_use_id: 'tool-1', necessary: 'unclear', rationale: 'Completion hook was unmatched.' },
          { event_id: 'pre-tool-2', tool_use_id: 'tool-2', necessary: 'unclear', rationale: 'Completion hook was unmatched.' },
        ],
        skills: [],
      },
      evaluation: {
        schema_version: '1',
        source: 'session-evaluator',
        verdict: 'fail',
        critique: 'The trace contains unmatched tool hooks.',
        review_signals: [{
          name: 'unmatched_tool_hook_pairs',
          count: 2,
          severity: 'warning',
          detail: 'The persisted annotation marked two tool records unclear because their completion hooks were unmatched.',
        }],
        judge_alignment: { status: 'not_recorded' },
        evaluation_ledger: { project: 'nala-trace', improvements: [] },
      },
    }, {
      ...trace,
      timeline: [
        { id: 'pre-tool-1', hook_event_name: 'PreToolUse', tool_call_index: 0 },
        { id: 'pre-tool-2', hook_event_name: 'PreToolUse', tool_call_index: 1 },
      ],
      tool_calls: [
        { tool_use_id: 'tool-1', tool_name: 'view_image', input: { detail: 'high', path: 'one.svg' } },
        { tool_use_id: 'tool-2', tool_name: 'rg', input: { cmd: 'rg --files' } },
      ],
    })

    expect(model.evaluation.reviewSignals[0]).toMatchObject({
      occurrenceCount: 2,
      occurrences: [
        expect.objectContaining({ label: 'view_image', toolUseId: 'tool-1', eventId: 'pre-tool-1' }),
        expect.objectContaining({ label: 'rg', toolUseId: 'tool-2', eventId: 'pre-tool-2' }),
      ],
    })
  })

  it('preserves captured invocation and completion evidence for annotation records', () => {
    const model = normalizeSessionAnalysis({
      annotation: {
        schema_version: '1',
        source: 'session-annotator',
        turns: [],
        tools: [{
          event_id: 'patch-pre-1',
          tool_use_id: 'patch-use-1',
          necessary: 'unclear',
          rationale: 'The captured apply_patch call has no completed hook pair in this snapshot, so its necessity cannot be confirmed from complete evidence.',
        }],
        skills: [{
          event_id: 'skill-pre-1',
          skill_name: 'frontend-design',
          necessary: 'yes',
          rationale: 'The skill supported the required frontend design, responsive interaction, or browser verification work.',
        }],
      },
      evaluation: null,
    }, {
      ...trace,
      timeline: [{ id: 'patch-pre-1', hook_event_name: 'PreToolUse', tool_call_index: 0 }],
      tool_calls: [{
        tool_use_id: 'patch-use-1',
        tool_name: 'apply_patch',
        input: { patch: '*** Update File: frontend/src/App.jsx' },
        status: 'unmatched',
      }],
      skill_invocations: [{
        name: 'frontend-design',
        event_id: 'skill-pre-1',
        tool_use_id: 'skill-use-1',
        tool_name: 'skill',
        confidence: 'explicit',
      }],
    })

    const tool = model.annotation.categories.find((category) => category.key === 'tools').records[0]
    const skill = model.annotation.categories.find((category) => category.key === 'skills').records[0]

    expect(tool).toMatchObject({
      toolName: 'apply_patch',
      inputPreview: expect.stringContaining('frontend/src/App.jsx'),
      completionStatus: 'unmatched',
      completionDetail: expect.stringContaining('No matching completion hook'),
    })
    expect(skill).toMatchObject({
      skillName: 'frontend-design',
      toolName: 'skill',
      toolUseId: 'skill-use-1',
      confidence: 'explicit',
      invocationDetail: expect.stringContaining('frontend-design'),
    })
  })

  it('derives one actionable follow-up per recorded warning signal', () => {
    const model = normalizeSessionAnalysis({
      annotation: { schema_version: '1', source: 'session-annotator', turns: [], tools: [], skills: [] },
      evaluation: {
        schema_version: '1',
        source: 'session-evaluator',
        verdict: 'fail',
        critique: 'The result has review findings.',
        review_signals: [
          { name: 'unmatched_tool_hook_pairs', count: 15, severity: 'warning', detail: 'Fifteen tool records have incomplete hook evidence.' },
          { name: 'unverified_authenticated_browser_flow', count: 1, severity: 'warning', detail: 'Authenticated browser evidence is missing.' },
          { name: 'delivery_branch_collision_recovered', count: 1, severity: 'warning', detail: 'A branch collision was recovered.' },
          { name: 'environment_retry_without_regression', count: 1, severity: 'info', detail: 'A retry completed without regression.' },
        ],
        judge_alignment: { status: 'not_recorded' },
        evaluation_ledger: {
          project: 'nala-trace',
          improvements: [{ path: 'AGENTS.md', change: 'Clarify review ownership.', reason: 'The rule was ambiguous.' }],
        },
      },
    }, trace)

    expect(model.evaluation.followUps).toEqual([
      expect.objectContaining({
        signalKey: 'unmatched_tool_hook_pairs',
        action: 'Restore or verify completion-hook pairing for the listed tool calls before treating their necessity as known.',
        occurrenceCount: 15,
      }),
      expect.objectContaining({
        signalKey: 'unverified_authenticated_browser_flow',
        action: 'Run the authenticated desktop and mobile browser flow and record the result.',
      }),
      expect.objectContaining({
        signalKey: 'delivery_branch_collision_recovered',
        action: 'Verify the final branch base, head, and PR after collision recovery.',
      }),
    ])
  })
})
