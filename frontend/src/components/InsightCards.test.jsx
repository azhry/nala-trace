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
    expect(screen.getByText('Concrete changes suggested by the evaluation.')).toBeInTheDocument()
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

    expect(screen.getByText('Unmatched tool hook pairs')).toBeInTheDocument()
    expect(screen.getByText('Unmatched event: Codex response: The assistant completed the requested inspection.')).toBeInTheDocument()
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
