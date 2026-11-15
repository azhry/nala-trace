import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders explicit not-recorded state for null API analysis', () => {
    render(<InsightCards analysis={null} trace={trace} />)

    const panel = screen.getByRole('complementary', { name: 'Review details' })
    expect(screen.getByRole('heading', { name: 'Review details' })).toBeInTheDocument()
    expect(panel).toHaveClass('analysis-full-page')
    expect(screen.getByText('No analysis saved')).toBeInTheDocument()
    expect(screen.getAllByText('Not recorded')).toHaveLength(3)
    expect(screen.queryByText('Pass')).not.toBeInTheDocument()
  })

  it('leaves legacy coverage unavailable when the compact analysis response has no trace', () => {
    render(<InsightCards forceAnalysis analysis={{
      annotation: {
        schema_version: '1',
        source: 'session-annotator',
        turns: [{ event_id: 'legacy-agent-1', performance: 'improved', rationale: 'The requested result was completed.' }],
      },
      evaluation,
    }} />)

    expect(screen.getAllByText('1 saved record').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Coverage: Coverage unavailable · Unavailable in this response')).toBeInTheDocument()
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

    expect(screen.getByText('Coverage: 1 captured agent turn')).toBeInTheDocument()
    expect(screen.getByText('Coverage: 1 captured tool call')).toBeInTheDocument()
    expect(screen.getByText('Coverage source: Current trace conversation')).toBeInTheDocument()
    expect(screen.getByText('Effect on the result')).toBeInTheDocument()
    expect(screen.getAllByText('No outcome change recorded').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('“No outcome change recorded” means the evaluator did not see this turn change the result. It does not mean the response was good or bad.')).toBeInTheDocument()
    expect(screen.getAllByText('The assistant completed the requested inspection.', { exact: false }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('rg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy tool use ID tool-1' })).toBeInTheDocument()
    expect(screen.getByText('rg --files', { exact: false })).toBeInTheDocument()
    expect(screen.getAllByText('The recorded turn stayed within scope.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Evaluation result')).toBeInTheDocument()
    expect(screen.getAllByText('Pass')).toHaveLength(2)
    expect(screen.getByText('The recorded workflow is complete.')).toBeInTheDocument()
    expect(screen.getAllByText('files read before write').some((element) => element.tagName === 'STRONG')).toBe(true)
    expect(screen.getByText('Warning and critical labels need review. Info labels provide context. Each listed occurrence is an explicit saved event, not an example parsed from the description.')).toBeInTheDocument()
    expect(screen.getByText('1 occurrence · Info')).toBeInTheDocument()
    expect(screen.getAllByText('Instruction adherence: Followed').some((element) => element.tagName === 'SPAN')).toBe(true)
    expect(screen.getAllByText('Needed for task: Not needed').some((element) => element.tagName === 'SPAN')).toBe(true)
    expect(screen.queryByText(/Follows instructions means whether the captured turn followed/)).not.toBeInTheDocument()
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
    expect(screen.getByText('Every action targets agent behavior or agent instruction Markdown. The project name is context only.')).toBeInTheDocument()
    expect(screen.getByText('Project context')).toBeInTheDocument()
    expect(screen.getByText('This is the evaluated project, not an improvement target.')).toBeInTheDocument()
    expect(screen.getByText('Agent instructions')).toBeInTheDocument()
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
    expect(screen.getAllByText('Unmatched event: a cited event reference.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('References cited in finding description')).toBeInTheDocument()
    expect(screen.getByText('No explicit occurrences saved')).toBeInTheDocument()
    expect(screen.queryByText(/ObjectID\("stop-1"\)/)).not.toBeInTheDocument()
    expect(screen.getByText('2 occurrences · Warning')).toBeInTheDocument()
    expect(screen.getAllByText('Review concern').length).toBeGreaterThanOrEqual(2)
  })

  it('shows a cited ObjectId as readable tool context, separately from saved occurrence counts', () => {
    render(<InsightCards forceAnalysis analysis={{
      annotation: {
        schema_version: '2',
        source: 'session-annotator',
        user_turns: [],
        turns: [],
        tools: [{ event_id: 'cited-tool-event', tool_name: 'Bash', input_summary: 'npm test', output_summary: 'All tests passed.' }],
        skills: [],
        files: [],
      },
      evaluation: {
        ...evaluation,
        schema_version: '2',
        review_signals: [{
          name: 'unmatched_tool_hook_pairs',
          count: 2,
          severity: 'warning',
          detail: 'A tool event was cited as ObjectId("cited-tool-event").',
          occurrences: [],
        }],
      },
    }} />)

    expect(screen.getAllByText('A tool event was cited as a cited event reference.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('References cited in finding description')).toBeInTheDocument()
    expect(screen.getByText('No explicit occurrences saved')).toBeInTheDocument()
    expect(screen.getByText('2 occurrences · Warning')).toBeInTheDocument()
    expect(screen.queryByText(/ObjectId\("cited-tool-event"\)/)).not.toBeInTheDocument()

    const citationButton = screen.getByRole('button', { name: 'Copy Event ID cited in prose cited-tool-event' })
    const citation = citationButton.closest('.analysis-event-evidence')
    const context = citation.querySelector('.analysis-linked-event-context')
    const id = citation.querySelector('code')
    expect(context).toHaveTextContent('Tool call · Bash')
    expect(context).toHaveTextContent('npm test')
    expect(context).toHaveTextContent('All tests passed.')
    expect(context.compareDocumentPosition(id) & 4).toBeTruthy()
  })

  it('resolves related and action evidence IDs, explains unmatched references, and supports keyboard copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const clipboardNavigator = Object.create(navigator)
    Object.defineProperty(clipboardNavigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.stubGlobal('navigator', clipboardNavigator)

    render(<InsightCards forceAnalysis analysis={{
      annotation: {
        schema_version: '2',
        source: 'session-annotator',
        user_turns: [],
        turns: [{ event_id: 'agent-event', response_summary: 'Ran the requested check.', related_event_ids: ['tool-event', 'trace-user-event', 'trace-assistant-event', 'trace-tool-event', 'trace-skill-event', 'trace-file-event', 'missing-related-event'] }],
        tools: [{ event_id: 'tool-event', tool_name: 'Bash', input_summary: 'npm run lint', output_summary: 'No lint findings.' }],
        skills: [],
        files: [],
      },
      evaluation: {
        ...evaluation,
        schema_version: '2',
        evaluation_ledger: {
          improvements: [{ target_type: 'agent_instructions', change: 'Keep a focused check.', reason: 'The saved check identified this need.', evidence_event_ids: ['tool-event', 'trace-tool-event', 'missing-action-event'] }],
        },
      },
    }} trace={{
      conversation: [
        { event_id: 'trace-user-event', role: 'user', content: 'Please verify the current branch.' },
        { event_id: 'trace-assistant-event', role: 'assistant', content: 'I checked the current branch.' },
      ],
      timeline: [{ id: 'trace-tool-event', hook_event_name: 'PreToolUse', tool_call_index: 0 }],
      tool_calls: [{ tool_name: 'Bash', input: { cmd: 'npm run test' }, output: 'All 14 focused tests passed.', status: 'completed' }],
      skill_invocations: [{ event_id: 'trace-skill-event', name: 'session-evaluator', summary: 'Evaluated the captured conversation.' }],
      files: [{ event_id: 'trace-file-event', path: '.agents/AGENTS.md', operation: 'read', summary: 'Read project instructions.' }],
    }} />)

    const relatedButton = screen.getByRole('button', { name: 'Copy Related event ID tool-event' })
    const relatedEvidence = relatedButton.closest('.analysis-event-evidence')
    expect(relatedEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('Tool call · Bash')
    expect(relatedEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('npm run lint')
    expect(relatedEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('No lint findings.')

    const userMessageEvidence = screen.getByRole('button', { name: 'Copy Related event ID trace-user-event' }).closest('.analysis-event-evidence')
    expect(userMessageEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('Captured user message')
    expect(userMessageEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('Please verify the current branch.')

    const assistantMessageEvidence = screen.getByRole('button', { name: 'Copy Related event ID trace-assistant-event' }).closest('.analysis-event-evidence')
    expect(assistantMessageEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('Captured assistant response')
    expect(assistantMessageEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('I checked the current branch.')

    const traceSkillEvidence = screen.getByRole('button', { name: 'Copy Related event ID trace-skill-event' }).closest('.analysis-event-evidence')
    expect(traceSkillEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('Captured skill invocation · session-evaluator')
    expect(traceSkillEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('Evaluated the captured conversation.')

    const traceFileEvidence = screen.getByRole('button', { name: 'Copy Related event ID trace-file-event' }).closest('.analysis-event-evidence')
    expect(traceFileEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('Captured file operation · read')
    expect(traceFileEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('.agents/AGENTS.md')
    expect(traceFileEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('Read project instructions.')

    const traceToolEvidence = screen.getByRole('button', { name: 'Copy Related event ID trace-tool-event' }).closest('.analysis-event-evidence')
    expect(traceToolEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('Captured tool call · Bash')
    expect(traceToolEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('PreToolUse')
    expect(traceToolEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('npm run test')
    expect(traceToolEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('All 14 focused tests passed.')
    expect(traceToolEvidence.querySelector('.analysis-linked-event-context')).toHaveTextContent('completed')

    const missingRelatedButton = screen.getByRole('button', { name: 'Copy Related event ID missing-related-event' })
    expect(missingRelatedButton.closest('.analysis-event-evidence')).toHaveTextContent('No matching saved event context was found for this reference.')
    const missingActionButton = screen.getByRole('button', { name: 'Copy Action evidence ID missing-action-event' })
    expect(missingActionButton.closest('.analysis-event-evidence')).toHaveTextContent('Context unavailable')

    const actionButton = screen.getByRole('button', { name: 'Copy Action evidence ID tool-event' })
    actionButton.focus()
    expect(actionButton).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(writeText).toHaveBeenCalledWith('tool-event')
    expect(screen.getAllByRole('status').some((status) => status.textContent === 'Copied')).toBe(true)
  })

  it('shows only explicit signal occurrences and filters annotation evidence by decision', () => {
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
          detail: 'The evaluator saved two locations for follow-up.',
          occurrences: [
            { event_id: 'signal-event-1', event_kind: 'PreToolUse', summary: 'Tool started without a completion.', impact: 'Its result is not verifiable.' },
            { event_id: 'signal-event-2', event_kind: 'PreToolUse', summary: 'Another tool started without a completion.', impact: 'Its result is not verifiable.' },
          ],
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

    expect(screen.getByText('2 located of 2 recorded')).toBeInTheDocument()
    const occurrenceButton = screen.getAllByRole('button', { name: 'Copy Occurrence event ID signal-event-1' })[0]
    expect(occurrenceButton).toBeInTheDocument()
    expect(screen.getAllByText('PreToolUse').length).toBeGreaterThanOrEqual(1)
    const occurrenceEvidence = occurrenceButton.closest('.analysis-event-evidence')
    expect(occurrenceEvidence).toHaveTextContent('Tool started without a completion.')
    expect(screen.queryByText('mcp__codex_apps__linear__list_comments')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Evidence type')).toBeInTheDocument()
    expect(screen.getByLabelText('Decision or label')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Decision or label'), { target: { value: 'followsInstructions:no' } })

    expect(screen.getByText('Filters match 1 of 2 saved records')).toBeInTheDocument()
    expect(screen.getAllByText('The turn broke an instruction.').length).toBeGreaterThanOrEqual(1)
    const agentTurnsCategory = Array.from(document.querySelectorAll('.analysis-category-card')).find((category) => category.textContent.includes('Agent turns'))
    expect(agentTurnsCategory.querySelector('.analysis-evidence-list')).not.toHaveTextContent('The turn followed instructions.')
  })

  it('renders v2 turn, tool, skill, file, capture-gap, occurrence, and action evidence with filters', () => {
    render(<InsightCards forceAnalysis analysis={{
      updated_at: '2026-10-24T10:00:00Z',
      annotation: {
        schema_version: '2',
        source: 'session-annotator',
        coverage: {
          user_turns: { captured: 1, labeled: 1, unclear: 0 },
          agent_turns: { captured: 1, labeled: 1, unclear: 0 },
          tool_calls: { captured: 1, labeled: 1, unclear: 1 },
          skill_invocations: { captured: 1, labeled: 1, unclear: 0 },
          file_operations: { captured: 1, labeled: 1, unclear: 0 },
        },
        user_turns: [{ event_id: 'user-event-1', signal_type: 'clarification', summary: 'Only change the evaluation page.', rationale: 'The user narrowed the requested implementation scope.' }],
        turns: [{
          event_id: 'agent-event-1',
          response_summary: 'Updated the evaluation interface.',
          scope_adherence: 'deviation',
          groundedness: 'unsupported',
          verification: 'not_verified',
          related_event_ids: ['tool-event-1'],
        }],
        tools: [{ event_id: 'tool-event-1', tool_name: 'Bash', input_summary: 'npm run build', output_summary: 'Vite built the frontend.', completion_status: 'incomplete', necessary: 'unclear' }],
        skills: [{ event_id: 'skill-event-1', skill_name: 'frontend-design', summary: 'Improved the forensic evidence layout.' }],
        files: [{ event_id: 'file-event-1', path: '.agents/AGENTS.md', operation: 'read', summary: 'Read the agent instructions.' }],
        capture_gaps: [{ category: 'Tool calls', event_ids: ['gap-event-1'], summary: 'A tool completion was not captured.', impact: 'The tool result cannot be confirmed.' }],
      },
      evaluation: {
        schema_version: '2',
        source: 'session-evaluator',
        verdict: 'fail',
        critique: 'A tool outcome could not be verified.',
        review_signals: [{
          name: 'unmatched_tool_hook_pairs',
          count: 1,
          severity: 'warning',
          detail: 'A completion event is missing.',
          occurrences: [{ event_id: 'gap-event-1', event_kind: 'PreToolUse', occurred_at: '2026-10-24T10:00:00Z', summary: 'The tool invocation has no completion event.', impact: 'Its outcome cannot be verified.' }],
        }],
        evaluation_ledger: { improvements: [{ target_type: 'agent_instructions', change: 'Require a completion-event check.', reason: 'The previous review could not verify the tool outcome.', evidence_event_ids: ['gap-event-1'] }] },
      },
    }} />)

    expect(screen.getByText('Current saved record')).toBeInTheDocument()
    expect(screen.getAllByText('Schema v2')).toHaveLength(2)
    expect(screen.getByText('Source: session-annotator')).toBeInTheDocument()
    expect(screen.getByText('Source: session-evaluator')).toBeInTheDocument()
    expect(screen.getByText(/Annotation and evaluation have separate sources and schema versions with one shared update time\. This response contains only the current pair; revision history is not stored/)).toBeInTheDocument()
    expect(screen.getByLabelText('Saved analysis record').querySelector('time')?.dateTime).toBe('2026-10-24T10:00:00Z')
    expect(screen.getAllByText(/Coverage: 1 labeled \/ 1 captured/).length).toBeGreaterThanOrEqual(5)
    expect(screen.getByText('What the user said')).toBeInTheDocument()
    expect(screen.getByText('Only change the evaluation page.')).toBeInTheDocument()
    expect(screen.getByText('Why this message was classified this way')).toBeInTheDocument()
    expect(screen.getByText('The user narrowed the requested implementation scope.')).toBeInTheDocument()
    expect(screen.getByText('Updated the evaluation interface.')).toBeInTheDocument()
    expect(screen.getByText('Scope: Deviation')).toBeInTheDocument()
    expect(screen.getAllByText('Claims: Unsupported').some((element) => element.tagName === 'SPAN')).toBe(true)
    expect(screen.getByText('Verification: Not Verified')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Verification: Partial' })).not.toBeInTheDocument()
    expect(screen.getAllByText(/1 record has one or more unclear decisions/)).toHaveLength(1)
    expect(screen.getAllByText('No records have an unclear decision.')).toHaveLength(4)
    const buildEvidence = screen.getByRole('button', { name: 'Copy event ID tool-event-1' }).closest('.analysis-event-evidence')
    expect(buildEvidence).toHaveTextContent('npm run build')
    expect(buildEvidence).toHaveTextContent('Vite built the frontend.')
    expect(buildEvidence).toHaveTextContent('The tool call was recorded, but its completion evidence is incomplete.')
    expect(screen.getByText('Improved the forensic evidence layout.')).toBeInTheDocument()
    expect(screen.getByText('.agents/AGENTS.md')).toBeInTheDocument()
    const captureGapEvidence = document.querySelector('.analysis-capture-gap')
    expect(captureGapEvidence).toHaveTextContent('A tool completion was not captured.')
    expect(captureGapEvidence).toHaveTextContent('The tool result cannot be confirmed.')
    expect(screen.getAllByRole('button', { name: 'Copy Action evidence ID gap-event-1' })).toHaveLength(2)
    const gapOccurrenceEvidence = screen.getAllByRole('button', { name: 'Copy Occurrence event ID gap-event-1' })[0].closest('.analysis-event-evidence')
    expect(gapOccurrenceEvidence).toHaveTextContent('PreToolUse')
    expect(gapOccurrenceEvidence.querySelector('time')?.dateTime).toBe('2026-10-24T10:00:00Z')
    expect(gapOccurrenceEvidence).toHaveTextContent('The tool invocation has no completion event.')
    expect(gapOccurrenceEvidence).toHaveTextContent('Its outcome cannot be verified.')
    expect(screen.getByText('Require a completion-event check.')).toBeInTheDocument()
    expect(screen.getByText('Agent instructions')).toBeInTheDocument()
    expect(screen.getAllByText('gap-event-1').length).toBeGreaterThanOrEqual(2)

    fireEvent.change(screen.getByLabelText('Evidence type'), { target: { value: 'turns' } })
    fireEvent.change(screen.getByLabelText('Decision or label'), { target: { value: 'scopeAdherence:deviation' } })
    expect(screen.getByText('Filters match 1 of 1 saved records')).toBeInTheDocument()
    expect(screen.getByText('Updated the evaluation interface.')).toBeInTheDocument()
    expect(screen.queryByText('Only change the evaluation page.')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Evidence type'), { target: { value: 'capture_gaps' } })
    expect(screen.getByLabelText('Decision or label')).toBeDisabled()
    expect(screen.getByText('Filters match 1 of 1 saved records')).toBeInTheDocument()
    expect(document.querySelector('.analysis-capture-gap')).toHaveTextContent('A tool completion was not captured.')
    expect(screen.queryByText('Updated the evaluation interface.')).not.toBeInTheDocument()
  })

  it('shows per-turn evidence rationales and occurrence details linked to the trace', () => {
    render(<InsightCards forceAnalysis sessionId="session-review-evidence" analysis={{
      annotation: {
        schema_version: '2',
        turns: [
          { event_id: 'turn-improved', performance: 'improved', follows_instructions: 'yes', verification: 'verified', rationale: 'The saved checks verified the requested result.', response_summary: 'The requested result was verified.' },
          { event_id: 'turn-neutral', performance: 'neutral', response_summary: 'The response repeated the current status.' },
          { event_id: 'turn-worsened', performance: 'worsened', scope_adherence: 'deviation', response_summary: 'The response changed unrelated files.' },
        ],
      },
      evaluation: {
        ...evaluation,
        review_signals: [
          {
            name: 'unmatched_tool_hook_pairs',
            count: 1,
            severity: 'warning',
            detail: 'A tool result is missing.',
            occurrences: [{
              event_id: 'tool-occurrence-1',
              event_kind: 'PreToolUse',
              occurred_at: '2026-10-24T10:00:00Z',
              tool_name: 'Bash',
              input_summary: 'npm test',
              summary: 'The command started without a completion event.',
              impact: 'The result cannot be confirmed.',
            }],
          },
          {
            name: 'missing_trace_context',
            count: 1,
            severity: 'critical',
            detail: 'Reference ObjectId("missing-event") has no saved event context.',
            occurrences: [{ event_id: 'missing-event' }],
          },
        ],
      },
    }} />)

    const turnImpact = document.querySelector('[aria-labelledby="analysis-turn-impact-title"]')
    const turnCards = Array.from(turnImpact.querySelectorAll('.analysis-turn-impact-item'))
    expect(turnCards).toHaveLength(3)
    expect(within(turnCards[0]).getByText('Why this label')).toBeInTheDocument()
    expect(within(turnCards[0]).getByText('The saved checks verified the requested result.')).toBeInTheDocument()
    expect(within(turnCards[0]).getByText('Recorded basis')).toBeInTheDocument()
    expect(within(turnCards[0]).getByText('Instruction following')).toBeInTheDocument()
    expect(within(turnCards[0]).getByText('Verification')).toBeInTheDocument()
    expect(within(turnCards[1]).getByText('Why this label')).toBeInTheDocument()
    expect(within(turnCards[1]).getByText('No rationale recorded.')).toBeInTheDocument()
    expect(within(turnCards[1]).getByText('No supporting labels recorded.')).toBeInTheDocument()
    expect(within(turnCards[1]).queryByText(/evaluator marked|captured response says/i)).not.toBeInTheDocument()
    expect(within(turnCards[2]).getByText('Why this label')).toBeInTheDocument()
    expect(within(turnCards[2]).getByText('No rationale recorded.')).toBeInTheDocument()
    expect(within(turnCards[2]).getByText('Recorded basis')).toBeInTheDocument()
    expect(within(turnCards[2]).getByText('Scope')).toBeInTheDocument()
    const priorityFinding = document.querySelector('.analysis-priority-finding')
    expect(priorityFinding).toHaveTextContent('Saved occurrence details')
    expect(priorityFinding).toHaveTextContent('Tool call · Bash')
    expect(priorityFinding).toHaveTextContent('npm test')
    expect(priorityFinding).toHaveTextContent('The command started without a completion event.')
    expect(priorityFinding.querySelector('time[datetime="2026-10-24T10:00:00Z"]')).toBeInTheDocument()
    expect(Array.from(priorityFinding.querySelectorAll('.analysis-open-trace-link')).map((link) => link.getAttribute('href'))).toContain('#/sessions/session-review-evidence?event=tool-occurrence-1')
    const missingPriorityFinding = document.querySelectorAll('.analysis-priority-finding')[1]
    expect(missingPriorityFinding).toHaveTextContent('Context unavailable')
    expect(screen.queryByText(/ObjectId\("missing-event"\)/)).not.toBeInTheDocument()
    expect(Array.from(missingPriorityFinding.querySelectorAll('.analysis-open-trace-link')).map((link) => link.getAttribute('href'))).toContain('#/sessions/session-review-evidence?event=missing-event')
  })

  it('matches wrapped ObjectID occurrences to plain trace IDs and links with the normalized ID', () => {
    const eventId = 'abcdef0123456789abcdef01'
    render(<InsightCards forceAnalysis sessionId="session-object-id" trace={{
      schema_version: '1',
      timeline: [{ id: eventId, hook_event_name: 'PreToolUse', occurred_at: '2026-10-24T10:00:00Z', tool_call_index: 0 }],
      tool_calls: [{ tool_name: 'Bash', input: { command: 'npm test' }, status: 'recorded' }],
    }} analysis={{
      annotation: { schema_version: '2', turns: [] },
      evaluation: {
        ...evaluation,
        review_signals: [{
          name: 'unmatched_tool_hook_pairs',
          count: 1,
          severity: 'warning',
          detail: 'A tool completion is missing.',
          occurrences: [{ event_id: `ObjectID("${eventId.toUpperCase()}")`, event_kind: 'PreToolUse', occurred_at: '2026-10-24T10:00:00Z', tool_name: 'Bash', input_summary: 'npm test' }],
        }],
      },
    }} />)

    const occurrence = document.querySelector('.analysis-signal-occurrence')
    expect(occurrence).toHaveTextContent('Captured tool call · Bash')
    expect(occurrence).toHaveTextContent('npm test')
    expect(occurrence.querySelector('.analysis-open-trace-link')).toHaveAttribute('href', `#/sessions/session-object-id?event=${eventId}`)
    expect(occurrence.querySelector('.analysis-copy-event-id')).toHaveAccessibleName(`Copy Occurrence event ID ${eventId}`)
    expect(occurrence).not.toHaveTextContent('ObjectID(')
  })

  it('keeps Why this label and Recorded basis visible on every turn in the first bounded page', () => {
    const turns = Array.from({ length: 10 }, (_item, index) => ({
      event_id: `bounded-turn-${index}`,
      performance: 'improved',
      rationale: `Saved rationale ${index}.`,
      follows_instructions: 'yes',
      response_summary: `Saved response ${index}.`,
    }))
    render(<InsightCards forceAnalysis analysis={{
      annotation: { schema_version: '2', turns },
      evaluation: { ...evaluation, review_signals: [] },
    }} />)

    const turnImpact = document.querySelector('[aria-labelledby="analysis-turn-impact-title"]')
    const visibleCards = Array.from(turnImpact.querySelectorAll('.analysis-turn-impact-item'))
    expect(visibleCards).toHaveLength(8)
    for (const card of visibleCards) {
      expect(within(card).getByText('Why this label')).toBeInTheDocument()
      expect(within(card).getByText('Recorded basis')).toBeInTheDocument()
      expect(within(card).getByText('Instruction following')).toBeInTheDocument()
    }
    expect(within(turnImpact).getByRole('button', { name: 'Load more turn impact records' })).toBeInTheDocument()
  })

  it('filters turn impact and priority summaries with counts and reset controls', async () => {
    const user = userEvent.setup()
    render(<InsightCards forceAnalysis analysis={{
      annotation: {
        schema_version: '2',
        turns: [
          { event_id: 'improved-filter-event', performance: 'improved', response_summary: 'The result improved.' },
          { event_id: 'neutral-filter-event', performance: 'neutral', response_summary: 'The result stayed the same.' },
          { event_id: 'worsened-filter-event', performance: 'worsened', response_summary: 'The result worsened.' },
        ],
      },
      evaluation: {
        ...evaluation,
        review_signals: [
          { name: 'unmatched_tool_hook_pairs', count: 1, severity: 'warning', detail: 'A tool completion is missing.', occurrences: [] },
          { name: 'missing_trace_context', count: 1, severity: 'critical', detail: 'A trace reference needs review.', occurrences: [] },
          { name: 'saved_context_note', count: 1, severity: 'info', detail: 'Additional saved context.', occurrences: [] },
        ],
      },
    }} />)

    const impactSection = document.querySelector('[aria-labelledby="analysis-turn-impact-title"]')
    const impactFilter = screen.getByLabelText('Turn impact value')
    expect(screen.getByRole('option', { name: 'Improved (1)' })).toBeInTheDocument()
    expect(impactSection.querySelector('.analysis-highlight-filter-count')).toHaveTextContent('Showing 3 of 3 turn records')
    await user.selectOptions(impactFilter, 'neutral')
    expect(impactSection.querySelector('.analysis-highlight-filter-count')).toHaveTextContent('Showing 1 of 3 turn records')
    expect(impactSection.querySelectorAll('.analysis-turn-impact-item')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Clear turn impact filter' }))
    expect(impactSection.querySelector('.analysis-highlight-filter-count')).toHaveTextContent('Showing 3 of 3 turn records')

    const findingsSection = document.querySelector('[aria-labelledby="analysis-priority-findings-title"]')
    const severityFilter = screen.getByLabelText('Priority finding severity')
    const categoryFilter = screen.getByLabelText('Priority finding category')
    expect(screen.getByRole('option', { name: 'Critical (1)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Unmatched tool hook pairs (1)' })).toBeInTheDocument()
    expect(findingsSection.querySelector('.analysis-highlight-filter-count')).toHaveTextContent('Showing 2 of 2 priority findings')
    await user.selectOptions(severityFilter, 'warning')
    expect(findingsSection.querySelector('.analysis-highlight-filter-count')).toHaveTextContent('Showing 1 of 2 priority findings')
    await user.selectOptions(categoryFilter, 'missing_trace_context')
    expect(findingsSection.querySelector('.analysis-highlight-filter-count')).toHaveTextContent('Showing 0 of 2 priority findings')
    expect(findingsSection.querySelectorAll('.analysis-priority-findings-list > li')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Clear priority finding filters' }))
    expect(findingsSection.querySelector('.analysis-highlight-filter-count')).toHaveTextContent('Showing 2 of 2 priority findings')
    expect(findingsSection.querySelectorAll('.analysis-priority-findings-list > li')).toHaveLength(2)
  })

  it('separates saved rows from v2 coverage and shows each neutral rationale or marks it unclear', async () => {
    const user = userEvent.setup()
    render(<InsightCards forceAnalysis analysis={{
      updated_at: '2026-10-25T10:00:00Z',
      annotation: {
        schema_version: '2',
        source: 'session-annotator',
        coverage: { agent_turns: { captured: 4, labeled: 3, unclear: 0 } },
        turns: [
          { event_id: 'neutral-event-1', response_summary: 'The first response restated the request.', performance: 'neutral', rationale: 'The response restated the request without adding a useful next step.' },
          { event_id: 'neutral-event-2', response_summary: 'The second response repeated the same check.', performance: 'neutral', rationale: 'The repeated check did not change the outcome.' },
          { event_id: 'neutral-event-3', response_summary: 'The third response listed unchanged results.', performance: 'neutral' },
        ],
      },
      evaluation: { ...evaluation, review_signals: [] },
    }} />)

    expect(screen.getAllByText('The response restated the request without adding a useful next step.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('The repeated check did not change the outcome.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('No rationale recorded.').length).toBeGreaterThanOrEqual(1)
    await user.click(screen.getByText('Evidence details'))
    expect(screen.getAllByText('3 saved records').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Coverage: 3 labeled / 4 captured agent turns')).toBeInTheDocument()
    expect(screen.getByText('Coverage source: Saved schema v2 coverage')).toBeInTheDocument()
    expect(screen.getByText(/This response contains only the current pair; revision history is not stored/)).toBeInTheDocument()
  })

  it('marks a generic rationale repeated across neutral turns unclear while preserving the saved text', async () => {
    const user = userEvent.setup()
    const sharedRationale = 'The bounded environment and credential limitation kept each response to the same status.'
    render(<InsightCards forceAnalysis analysis={{
      annotation: {
        schema_version: '2',
        source: 'session-annotator',
        coverage: { agent_turns: { captured: 3, labeled: 3, unclear: 0 } },
        turns: [
          { event_id: 'shared-neutral-1', response_summary: 'The first response summarized the repository.', performance: 'neutral', rationale: sharedRationale },
          { event_id: 'shared-neutral-2', response_summary: 'The second response listed available tests.', performance: 'neutral', rationale: sharedRationale },
          { event_id: 'shared-neutral-3', response_summary: 'The third response repeated the result.', performance: 'neutral', rationale: sharedRationale },
        ],
      },
      evaluation: { ...evaluation, review_signals: [] },
    }} />)

    await user.click(screen.getByText('Evidence details'))

    expect(screen.getAllByText('Rationale: Unclear')).toHaveLength(9)
    expect(screen.getAllByText(/This saved rationale is repeated across 3 neutral turns and may not distinguish this turn/)).toHaveLength(9)
    expect(screen.getAllByText((_, element) => element.tagName === 'P' && element.textContent.includes(`Saved rationale: “${sharedRationale}”`))).toHaveLength(9)
    const agentTurnsCategory = Array.from(document.querySelectorAll('.analysis-category-card')).find((category) => category.textContent.includes('Agent turns'))
    expect(agentTurnsCategory.querySelector('.analysis-evidence-list')).toHaveTextContent('Rationale: Unclear')
  })

  it('filters signals by severity and category and names fields missing from saved occurrences', async () => {
    const user = userEvent.setup()
    render(<InsightCards forceAnalysis analysis={{
      annotation: null,
      evaluation: {
        ...evaluation,
        review_signals: [
          {
            name: 'unmatched_tool_hook_pairs',
            count: 3,
            severity: 'warning',
            detail: 'The invocation has no captured completion hook.',
            occurrences: [{ event_id: 'unmatched-hook-1', event_kind: 'PreToolUse' }],
          },
          {
            name: 'authenticated_browser_evidence',
            count: 1,
            severity: 'info',
            detail: 'The authenticated browser flow was not recorded.',
            occurrences: [],
          },
        ],
      },
    }} />)

    expect(screen.getAllByText('Not recorded in this saved occurrence: occurrence time, tool name, command or input, message, event summary, impact.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('The invocation has no captured completion hook.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('The authenticated browser flow was not recorded.')).toBeInTheDocument()
    const category = screen.getByLabelText('Signal category')
    expect(category.tagName).toBe('SELECT')
    await user.selectOptions(category, 'unmatched_tool_hook_pairs')
    expect(screen.getByText('Filters match 1 of 2 findings')).toBeInTheDocument()
    expect(screen.getAllByText('The invocation has no captured completion hook.').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('The authenticated browser flow was not recorded.')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Signal severity'), 'info')
    expect(screen.getByText('Filters match 0 of 2 findings')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('Filters match 2 of 2 findings')).toBeInTheDocument()
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
    expect(screen.getAllByText('Summary not included in this analysis version.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Why this label was applied')).toHaveLength(2)
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

    expect(screen.getByText('1 valid agent action')).toBeInTheDocument()
    expect(screen.getByText('3 follow-ups from warning findings')).toBeInTheDocument()
    expect(screen.getByText('Keep tool necessity marked unknown when the completion event is missing, and verify the event pair before relying on that tool result.')).toBeInTheDocument()
    expect(screen.getByText('For browser-dependent work, run the authenticated desktop and mobile checks and record what each one showed.')).toBeInTheDocument()
    expect(screen.getByText('Before handoff, verify that the final branch and pull request use the requested base and contain the intended changes.')).toBeInTheDocument()
    expect(screen.getAllByText('Suggested from a saved warning or critical finding')).toHaveLength(3)
    expect(screen.getByText('Clarify review ownership.')).toBeInTheDocument()
  })

  it('excludes a legacy project-source action from valid agent improvements', () => {
    render(<InsightCards analysis={{
      annotation: { schema_version: '1', source: 'session-annotator', turns: [], tools: [], skills: [] },
      evaluation: {
        ...evaluation,
        evaluation_ledger: {
          project: 'nala-trace',
          improvements: [{ path: 'frontend/src/App.jsx', change: 'Refactor the page layout.', reason: 'The page is hard to scan.' }],
        },
      },
    }} trace={trace} />)

    expect(screen.queryByText('Recorded changes')).not.toBeInTheDocument()
    expect(screen.getAllByText('1 legacy target excluded').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Out of scope — project source')).toBeInTheDocument()
    expect(screen.getByText('Excluded from agent improvements')).toBeInTheDocument()
    expect(screen.getByText('No agent improvement actions recorded')).toBeInTheDocument()
    expect(screen.getByText('frontend/src/App.jsx')).toBeInTheDocument()
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

    expect(screen.getAllByText('Unknown')).toHaveLength(2)
    expect(screen.getByText('No written critique was recorded.')).toBeInTheDocument()
    expect(screen.getByText('Judge alignment')).toBeInTheDocument()
    expect(screen.getByText('Comparison unavailable: a human label and evaluator label were not both recorded.')).toBeInTheDocument()
    expect(screen.queryByText('No analysis recorded')).not.toBeInTheDocument()
  })

  it('bounds large saved evidence and action lists without changing their totals', async () => {
    const user = userEvent.setup()
    const userTurns = Array.from({ length: 10 }, (_value, index) => ({
      event_id: `user-event-${index + 1}`,
      signal_type: 'request',
      summary: `Captured user turn ${index + 1}`,
      rationale: 'Saved as a plain UI fixture.',
    }))
    const improvements = Array.from({ length: 10 }, (_value, index) => ({
      target_type: 'agent_instructions',
      change: `Update agent guidance ${index + 1}`,
      reason: 'Keep the saved action explicit.',
      evidence_event_ids: Array.from({ length: 10 }, (_event, eventIndex) => `action-event-${index + 1}-${eventIndex + 1}`),
    }))

    render(<InsightCards forceAnalysis analysis={{
      annotation: { schema_version: '2', user_turns: userTurns },
      evaluation: { ...evaluation, schema_version: '2', evaluation_ledger: { improvements } },
    }} />)

    expect(screen.getByText('10 valid agent actions')).toBeInTheDocument()
    expect(screen.getByText('Update agent guidance 1')).toBeInTheDocument()
    expect(screen.queryByText('Update agent guidance 9')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 8 of 10 agent improvement actions')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more agent improvement actions' }))
    expect(screen.getByText('Update agent guidance 9')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show fewer agent improvement actions' })).toBeInTheDocument()

    const firstAction = document.querySelector('.analysis-actions-list > li')
    expect(firstAction).not.toBeNull()
    expect(firstAction.querySelector('.analysis-event-reference')).toHaveTextContent('action-event-1-1')
    expect(firstAction.querySelector('.analysis-list-pagination')).toHaveTextContent('Showing 8 of 10 action evidence references')
    await user.click(firstAction.querySelector('.analysis-list-pagination button'))
    expect(firstAction).toHaveTextContent('action-event-1-10')

    const userTurnSummary = Array.from(document.querySelectorAll('.analysis-category-summary'))
      .find((summary) => summary.textContent.includes('User turns'))
    expect(userTurnSummary).toBeDefined()
    await user.click(userTurnSummary)
    expect(screen.getByText('Captured user turn 8')).toBeInTheDocument()
    expect(screen.queryByText('Captured user turn 9')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 8 of 10 evidence records')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more evidence records' }))
    expect(screen.getByText('Captured user turn 9')).toBeInTheDocument()
    expect(screen.getByText('Filters match 10 of 10 saved records')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Evidence type'), { target: { value: 'user_turns' } })
    expect(screen.getByText('Showing 8 of 10 evidence records')).toBeInTheDocument()
  })

  it('bounds saved signal occurrences while retaining the evaluator total', async () => {
    const user = userEvent.setup()
    const occurrences = Array.from({ length: 10 }, (_value, index) => ({
      event_id: `signal-event-${index + 1}`,
      event_kind: 'PreToolUse',
      summary: `Occurrence summary ${index + 1}`,
      impact: 'The matching completion is not recorded.',
    }))

    render(<InsightCards forceAnalysis analysis={{
      annotation: null,
      evaluation: {
        ...evaluation,
        schema_version: '2',
        review_signals: [{
          name: 'unmatched_tool_hook_pairs',
          count: 11,
          severity: 'warning',
          detail: 'A completion event is missing.',
          occurrences,
        }],
      },
    }} />)

    expect(screen.getByText('10 located of 11 recorded')).toBeInTheDocument()
    expect(screen.getAllByText('Occurrence summary 1').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Occurrence summary 9')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 8 of 10 signal occurrences')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more signal occurrences' }))
    expect(screen.getAllByText('Occurrence summary 9').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Showing 10 of 10 signal occurrences')).toBeInTheDocument()
    expect(screen.getByText(/1 more are included in the count/)).toBeInTheDocument()
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
