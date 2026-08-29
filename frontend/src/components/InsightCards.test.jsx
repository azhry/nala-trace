import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import InsightCards from './InsightCards'

const trace = {
  schema_version: '1',
  conversation: [
    { role: 'user', turn_id: 'turn-1' },
    { role: 'assistant', turn_id: 'turn-1' },
  ],
  tool_calls: [{ tool_name: 'rg' }],
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

  it('renders annotation evidence, evaluation details, alignment, and ledger provenance', () => {
    render(<InsightCards analysis={{
      annotation: {
        schema_version: '1',
        source: 'session-annotator',
        turns: [{ event_id: 'stop-1', turn_id: 'turn-1', follows_instructions: 'yes', performance: 'neutral', rationale: 'The recorded turn stayed within scope.' }],
        tools: [{ event_id: 'tool-1', necessary: 'no', rationale: 'This lookup was not needed.' }],
        skills: [],
      },
      evaluation,
      updated_at: '2026-08-19T08:10:00Z',
    }} trace={trace} />)

    expect(screen.getAllByText('1 / 1 captured')).toHaveLength(2)
    expect(screen.getByText('The recorded turn stayed within scope.')).toBeInTheDocument()
    expect(screen.getByText('Evaluation result')).toBeInTheDocument()
    expect(screen.getByText('Pass')).toBeInTheDocument()
    expect(screen.getByText('The recorded workflow is complete.')).toBeInTheDocument()
    expect(screen.getByText('files read before write')).toBeInTheDocument()
    expect(screen.getByText('Aligned')).toBeInTheDocument()
    expect(screen.getByText('golden-set-v1')).toBeInTheDocument()
    expect(screen.getByText('nala-trace')).toBeInTheDocument()
    expect(screen.getByText('No instruction or workflow improvements were recorded.')).toBeInTheDocument()
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
    expect(screen.getByText('Recorded changes from the evaluator’s ledger.')).toBeInTheDocument()
    expect(screen.getByText('AGENTS.md')).toBeInTheDocument()
    expect(screen.getByText('Clarify the frontend handoff boundary.')).toBeInTheDocument()
    expect(screen.getByText('Reviewers need one unambiguous ownership rule.')).toBeInTheDocument()
    expect(screen.queryByText('How to read these labels')).not.toBeInTheDocument()
    expect(screen.queryByText('No improvement actions recorded')).not.toBeInTheDocument()
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
    expect(screen.getByText('Evaluation ledger')).toBeInTheDocument()
    expect(screen.getByText('Judge alignment')).toBeInTheDocument()
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
