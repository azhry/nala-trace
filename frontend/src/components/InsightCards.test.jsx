import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import InsightCards from './InsightCards'

const trace = {
  schema_version: '1',
  conversation: [
    { event_id: 'prompt-1', role: 'user', content: 'Please inspect the repository.', turn_id: 'turn-1' },
    { event_id: 'stop-1', role: 'assistant', content: 'The assistant completed the requested inspection.', turn_id: 'turn-1' },
  ],
  tool_calls: [{ tool_use_id: 'tool-1', tool_name: 'rg', input: { cmd: 'rg --files' } }],
  skill_invocations: [],
}

const evaluation = {
  schema_version: '1',
  source: 'session-evaluator',
  verdict: 'pass',
  critique: 'The recorded workflow is complete.',
  review_signals: [{ name: 'files read before write', count: 1, severity: 'info', detail: 'The trace contains the expected read evidence.' }],
  judge_alignment: { status: 'aligned', human_label: 'pass', evaluator_label: 'pass', agreement: true, dataset: 'golden-set-v1' },
  evaluation_ledger: { project: 'nala-trace', improvements: [] },
}

describe('InsightCards', () => {
  it('renders explicit not-recorded state for null API analysis', () => {
    render(<InsightCards analysis={null} trace={trace} />)

    const panel = screen.getByRole('complementary', { name: 'Recorded evaluation evidence' })
    expect(screen.getByRole('heading', { name: 'Recorded evaluation evidence' })).toBeInTheDocument()
    expect(panel).toHaveClass('analysis-full-page')
    expect(screen.getByText('No analysis recorded')).toBeInTheDocument()
    expect(screen.getAllByText('Not recorded')).toHaveLength(3)
    expect(screen.queryByText('Pass')).not.toBeInTheDocument()
  })

  it('keeps the detail summary compact and links to the dedicated evaluation page', () => {
    render(<InsightCards analysis={{ annotation: null, evaluation }} trace={trace} compact sessionId="session-1" />)

    expect(screen.getByRole('heading', { name: 'Evaluation summary' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open full evaluation' })).toHaveAttribute('href', '#/sessions/session-1/evaluation')
    expect(screen.getByText('Pass')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'What to improve' })).not.toBeInTheDocument()
    expect(screen.queryByText('The recorded workflow is complete.')).not.toBeInTheDocument()
  })

  it('renders annotation evidence, performance summary, tool details, and evaluation details', () => {
    render(<InsightCards analysis={{
      annotation: {
        schema_version: '1',
        source: 'session-annotator',
        turns: [{ event_id: 'stop-1', turn_id: 'turn-1', follows_instructions: 'yes', performance: 'neutral', rationale: 'The recorded turn stayed within scope.' }],
        tools: [{ event_id: 'pre-tool-1', tool_use_id: 'tool-1', necessary: 'no', rationale: 'This lookup was not needed.' }],
        skills: [],
      },
      evaluation,
      updated_at: '2026-08-19T08:10:00Z',
    }} trace={trace} />)

    expect(screen.getAllByText('1 labeled / 1 total')).toHaveLength(2)
    expect(screen.getByText('Turn performance')).toBeInTheDocument()
    expect(screen.getAllByText('Neutral').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Improved means the turn moved the result forward; neutral means no observable effect; worsened means it added rework, risk, or regression.')).toBeInTheDocument()
    expect(screen.getAllByText('The assistant completed the requested inspection.', { exact: false }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('rg')).toBeInTheDocument()
    expect(screen.getByText('tool use: tool-1')).toBeInTheDocument()
    expect(screen.getByText('rg --files', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('The recorded turn stayed within scope.')).toBeInTheDocument()
    expect(screen.getByText('Evaluation result')).toBeInTheDocument()
    expect(screen.getByText('Pass')).toBeInTheDocument()
    expect(screen.getByText('The recorded workflow is complete.')).toBeInTheDocument()
    expect(screen.getByText('files read before write')).toBeInTheDocument()
    expect(screen.getByText('Warning = a review concern. Info = context, not a failure.')).toBeInTheDocument()
    expect(screen.getByText('1 occurrence · Info')).toBeInTheDocument()
    expect(screen.getAllByText('Follows instructions: Yes').some((element) => element.tagName === 'SPAN')).toBe(true)
    expect(screen.getAllByText('Necessary for task: No').some((element) => element.tagName === 'SPAN')).toBe(true)
    expect(screen.getByText(/Follows instructions means whether the captured turn followed/)).toBeInTheDocument()
    expect(screen.getByText('Aligned')).toBeInTheDocument()
    expect(screen.getByText('golden-set-v1')).toBeInTheDocument()
    expect(screen.getByText('No improvement actions recorded')).toBeInTheDocument()
  })

  it('promotes recorded improvement actions without adding documentation to the page', () => {
    render(<InsightCards analysis={{
      annotation: { schema_version: '1', source: 'session-annotator', turns: [], tools: [], skills: [] },
      evaluation: {
        ...evaluation,
        evaluation_ledger: {
          project: 'nala-trace',
          improvements: [{
            path: 'AGENTS.md',
            change: 'Clarify the frontend handoff boundary.',
            reason: 'Reviewers need one unambiguous ownership rule.',
          }],
        },
      },
    }} trace={trace} />)

    expect(screen.getByRole('heading', { name: 'What to improve' })).toBeInTheDocument()
    expect(screen.getByText('Stored evaluator actions plus concrete next steps derived from recorded warning findings.')).toBeInTheDocument()
    expect(screen.getByText('AGENTS.md')).toBeInTheDocument()
    expect(screen.getByText('Clarify the frontend handoff boundary.')).toBeInTheDocument()
    expect(screen.getByText('Reviewers need one unambiguous ownership rule.')).toBeInTheDocument()
    expect(screen.queryByText('How to read these labels')).not.toBeInTheDocument()
    expect(screen.queryByText('No improvement actions recorded')).not.toBeInTheDocument()
  })

  it('turns signal keys and event references into readable review evidence', () => {
    render(<InsightCards analysis={{
      annotation: null,
      evaluation: {
        ...evaluation,
        review_signals: [{
          name: 'unmatched_tool_hook_pairs',
          count: 2,
          severity: 'warning',
          detail: 'Unmatched event: ObjectID("stop-1").',
        }],
      },
    }} trace={trace} />)

    expect(screen.getAllByText('Unmatched tool hook pairs').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Unmatched event: Codex response: The assistant completed the requested inspection.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('2 occurrences · Warning')).toBeInTheDocument()
    expect(screen.getByText('Review concern')).toBeInTheDocument()
  })

  it('shows individual signal examples and filters annotation evidence by decision', () => {
    render(<InsightCards analysis={{
      annotation: {
        schema_version: '1',
        source: 'session-annotator',
        turns: [
          { event_id: 'stop-1', turn_id: 'turn-1', follows_instructions: 'yes', performance: 'neutral', rationale: 'The turn followed instructions.' },
          { event_id: 'stop-2', turn_id: 'turn-2', follows_instructions: 'no', performance: 'worsened', rationale: 'The turn broke an instruction.' },
        ],
        tools: [],
        skills: [],
      },
      evaluation: {
        ...evaluation,
        review_signals: [{
          name: 'unmatched_tool_hook_pairs',
          count: 2,
          severity: 'warning',
          detail: 'Example event IDs: mcp__codex_apps__linear__list_comments: {"issueId":"issue-1"}, view_image: {"detail":"high","path":"before.svg"}.',
        }],
      },
    }} trace={{
      ...trace,
      conversation: [
        ...trace.conversation,
        { event_id: 'stop-2', role: 'assistant', content: 'The second captured response.', turn_id: 'turn-2' },
      ],
      tool_calls: [
        { tool_name: 'mcp__codex_apps__linear__list_comments', input: { issueId: 'issue-1' } },
        { tool_name: 'view_image', input: { detail: 'high', path: 'before.svg' } },
      ],
    }} />)

    expect(screen.getByText('2 examples shown of 2 recorded occurrences')).toBeInTheDocument()
    expect(screen.getByText('mcp__codex_apps__linear__list_comments')).toBeInTheDocument()
    expect(screen.getAllByText(/issueId.*issue-1/).some((element) => element.tagName === 'CODE')).toBe(true)
    expect(screen.getByText('view_image')).toBeInTheDocument()
    expect(screen.getAllByText(/path.*before\.svg/).some((element) => element.tagName === 'CODE')).toBe(true)
    expect(screen.getByLabelText('Evidence type')).toBeInTheDocument()
    expect(screen.getByLabelText('Annotation decision')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Annotation decision'), { target: { value: 'followsInstructions:no' } })

    expect(screen.getByText('Showing 1 of 2 labeled records')).toBeInTheDocument()
    expect(screen.getByText('The turn broke an instruction.')).toBeInTheDocument()
    expect(screen.queryByText('The turn followed instructions.')).not.toBeInTheDocument()
  })

  it('shows the captured context behind unclear tools and necessary skills', () => {
    render(<InsightCards analysis={{
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
      evaluation: { ...evaluation, review_signals: [] },
    }} trace={{
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
    }} />)

    expect(screen.getByText('apply_patch')).toBeInTheDocument()
    expect(screen.getByText('Completion evidence')).toBeInTheDocument()
    expect(screen.getByText('No matching completion hook was captured; the invocation is present but its completion evidence is incomplete.')).toBeInTheDocument()
    expect(screen.getByText('Captured invocation')).toBeInTheDocument()
    expect(screen.getByText(/tool: skill.*skill-use-1.*confidence: explicit/)).toBeInTheDocument()
    expect(screen.getByText('The skill supported the required frontend design, responsive interaction, or browser verification work.')).toBeInTheDocument()
  })

  it('turns warning findings into visible next steps alongside stored evaluator actions', () => {
    render(<InsightCards analysis={{
      annotation: { schema_version: '1', source: 'session-annotator', turns: [], tools: [], skills: [] },
      evaluation: {
        ...evaluation,
        verdict: 'fail',
        review_signals: [
          { name: 'unmatched_tool_hook_pairs', count: 15, severity: 'warning', detail: 'Fifteen tool records have incomplete hook evidence.' },
          { name: 'unverified_authenticated_browser_flow', count: 1, severity: 'warning', detail: 'Authenticated browser evidence is missing.' },
          { name: 'delivery_branch_collision_recovered', count: 1, severity: 'warning', detail: 'A branch collision was recovered.' },
          { name: 'environment_retry_without_regression', count: 1, severity: 'info', detail: 'A retry completed without regression.' },
        ],
        evaluation_ledger: {
          project: 'nala-trace',
          improvements: [{ path: 'AGENTS.md', change: 'Clarify review ownership.', reason: 'The rule was ambiguous.' }],
        },
      },
    }} trace={trace} />)

    expect(screen.getByText('1 recorded evaluator action')).toBeInTheDocument()
    expect(screen.getByText('3 follow-ups from warning findings')).toBeInTheDocument()
    expect(screen.getByText('Restore or verify completion-hook pairing for the listed tool calls before treating their necessity as known.')).toBeInTheDocument()
    expect(screen.getByText('Run the authenticated desktop and mobile browser flow and record the result.')).toBeInTheDocument()
    expect(screen.getByText('Verify the final branch base, head, and PR after collision recovery.')).toBeInTheDocument()
    expect(screen.getAllByText('Derived from recorded warning')).toHaveLength(3)
    expect(screen.getByText('Clarify review ownership.')).toBeInTheDocument()
  })

  it('keeps an evaluator unknown verdict distinct from a missing evaluation', () => {
    render(<InsightCards analysis={{ annotation: null, evaluation: {
      schema_version: '1',
      source: 'session-evaluator',
      verdict: 'unknown',
      critique: '',
      review_signals: [],
      judge_alignment: { status: 'not_recorded' },
      evaluation_ledger: { project: 'nala-trace', improvements: [] },
    } }} trace={trace} />)

    expect(screen.getByText('Unknown')).toBeInTheDocument()
    expect(screen.getByText('Critique not recorded.')).toBeInTheDocument()
    expect(screen.getByText('Judge alignment')).toBeInTheDocument()
    expect(screen.getByText('Comparison unavailable: a human label and evaluator label were not both recorded.')).toBeInTheDocument()
    expect(screen.queryByText('No analysis recorded')).not.toBeInTheDocument()
  })

  it('preserves the legacy fixture-shaped insights when no API trace is supplied', () => {
    render(<InsightCards insights={{
      metrics: [{ label: 'Semantic records', value: '12', detail: 'captured timeline' }],
      evalPasses: null,
      evalTotal: null,
      judgeAlignment: null,
      reviewSignal: 'Needs review',
    }} />)

    expect(screen.getByText('What this session contains')).toBeInTheDocument()
    expect(screen.getByText('Semantic records')).toBeInTheDocument()
    expect(screen.getByText('Needs review')).toBeInTheDocument()
  })
})
