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
  it('repairs a mojibaked session title without changing the session identifier', () => {
    render(<EvaluationPage session={{ ...session, id: 'session-Ã©', title: 'FranÃ§ais — 東京' }} analysis={session.analysis} onBack={vi.fn()} />)

    expect(screen.getByText('Français — 東京 · session-Ã©')).toBeInTheDocument()
  })

  it('shows the full review without the detail-page guide', () => {
    const onBack = vi.fn()
    render(<EvaluationPage session={session} analysis={session.analysis} onBack={onBack} />)

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
    render(<EvaluationPage session={session} analysis={session.analysis} onBack={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Review at a glance' })).toBeInTheDocument()
    expect(screen.getByText('The evaluator recorded a complete review.')).toBeInTheDocument()
    expect(screen.getByText('What to improve')).toBeInTheDocument()
    expect(screen.getByText('“No outcome change recorded” means the evaluator saw no change to the result; it does not mean the turn was good or bad.')).toBeInTheDocument()

    const evidenceDetails = screen.getByText('Evidence details').closest('details')
    expect(evidenceDetails).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Evidence details'))
    expect(evidenceDetails).toHaveAttribute('open')
  })

  it('places result impact, priority findings, agent changes, and evidence gaps before the audit trail', () => {
    const analysis = {
      annotation: {
        schema_version: '2',
        turns: [
          { event_id: 'turn-worsened', performance: 'worsened', response_summary: 'The missing tool result worsened the result.' },
          { event_id: 'turn-improved', performance: 'improved', response_summary: 'The later verified action improved the result.' },
        ],
        capture_gaps: [{ category: 'Tool calls', summary: 'Tool completion was not captured.', impact: 'The result cannot be verified.' }],
      },
      evaluation: {
        schema_version: '2',
        verdict: 'fail',
        critique: 'One evidence gap limits this evaluation.',
        review_signals: [{ name: 'unmatched_tool_hook_pairs', severity: 'warning', count: 1, detail: 'A completion event was missing.' }],
        evaluation_ledger: {
          improvements: [{
            target_type: 'agent_instructions',
            change: 'Require tool completion verification.',
            reason: 'The prior run ended before the result was checked.',
          }],
        },
      },
    }
    render(<EvaluationPage session={session} analysis={analysis} onBack={vi.fn()} />)

    const orderedContent = [
      screen.getByRole('heading', { name: 'Review at a glance' }),
      screen.getByRole('heading', { name: 'Turn impact' }),
      screen.getByRole('heading', { name: 'Priority findings' }),
      screen.getByRole('heading', { name: 'What to improve' }),
      screen.getByRole('heading', { name: 'Evidence gaps' }),
      screen.getByText('Evidence details').closest('summary'),
    ]
    for (let index = 0; index < orderedContent.length - 1; index += 1) {
      expect(orderedContent[index].compareDocumentPosition(orderedContent[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    }

    expect(screen.getAllByText('The missing tool result worsened the result.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('The later verified action improved the result.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Require tool completion verification.')).toBeInTheDocument()
    expect(screen.getAllByText('Tool completion was not captured.').length).toBeGreaterThanOrEqual(1)
  })

  it('distinguishes loading, missing, failed, and empty analysis states', () => {
    const retry = vi.fn()
    const { rerender } = render(<EvaluationPage session={session} analysisState="loading" onAnalysisRetry={retry} onBack={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading saved evaluation')

    rerender(<EvaluationPage session={session} analysisState="missing" onAnalysisRetry={retry} onBack={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Session analysis was not found')

    rerender(<EvaluationPage session={session} analysisState="error" analysisError={{ status: 500 }} onAnalysisRetry={retry} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry analysis request' }))
    expect(retry).toHaveBeenCalledOnce()

    rerender(<EvaluationPage session={session} analysisState="ready" analysis={null} onBack={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('No analysis saved')
  })
})
