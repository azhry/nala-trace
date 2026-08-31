import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EvaluationPage from './EvaluationPage'

const session = {
  id: 'session-evaluation-page',
  title: 'Review the evaluation page',
  schema_version: '1',
  conversation: [{ role: 'assistant', turn_id: 'turn-1' }],
  analysis: {
    annotation: {
      schema_version: '1',
      source: 'session-annotator',
      turns: [{ event_id: 'turn-event', turn_id: 'turn-1', follows_instructions: 'yes', performance: 'neutral', rationale: 'The recorded turn stayed within scope.' }],
      tools: [],
      skills: [],
    },
    evaluation: {
      schema_version: '1',
      source: 'session-evaluator',
      verdict: 'pass',
      critique: 'The evaluator recorded a complete review.',
      review_signals: [],
      judge_alignment: { status: 'aligned', human_label: 'pass', evaluator_label: 'pass', agreement: true },
      evaluation_ledger: {
        project: 'nala-trace',
        improvements: [{ path: 'AGENTS.md', change: 'Keep the handoff boundary explicit.', reason: 'The review identified an ownership ambiguity.' }],
      },
    },
  },
}

describe('EvaluationPage', () => {
  it('shows the full review without the detail-page guide', () => {
    const onBack = vi.fn()
    render(<EvaluationPage session={session} onBack={onBack} />)

    expect(screen.getByRole('heading', { name: 'Session evaluation', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review details' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What to improve' })).toBeInTheDocument()
    expect(screen.getByText('The evaluator recorded a complete review.')).toBeInTheDocument()
    expect(screen.getByText('Keep the handoff boundary explicit.')).toBeInTheDocument()
    expect(screen.queryByText('How to read these labels')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '← Session detail' }))
    expect(onBack).toHaveBeenCalledExactlyOnceWith()
  })

  it('leads with a human summary and progressively discloses forensic evidence', () => {
    render(<EvaluationPage session={session} onBack={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Review at a glance' })).toBeInTheDocument()
    expect(screen.getByText('The evaluator recorded a complete review.')).toBeInTheDocument()
    expect(screen.getByText('What to improve')).toBeInTheDocument()

    const evidenceDetails = screen.getByText('Evidence details').closest('details')
    expect(evidenceDetails).not.toHaveAttribute('open')

    fireEvent.click(screen.getByText('Evidence details'))
    expect(evidenceDetails).toHaveAttribute('open')
  })
})
