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

    const panel = screen.getByRole('complementary', { name: 'Review details' })
    expect(screen.getByRole('heading', { name: 'Review details' })).toBeInTheDocument()
    expect(panel).toHaveClass('analysis-full-page')
    expect(screen.getByText('No analysis saved')).toBeInTheDocument()
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

    expect(screen.getAllByText('1 labeled / 1 captured')).toHaveLength(2)
    expect(screen.getByText('Effect on the result')).toBeInTheDocument()
    expect(screen.getAllByText('No outcome change recorded').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('“No outcome change recorded” means the evaluator did not see this turn change the result. It does not mean the response was good or bad.')).toBeInTheDocument()
    expect(screen.getAllByText('The assistant completed the requested inspection.', { exact: false }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('rg')).toBeInTheDocument()
    expect(screen.getByText('tool use: tool-1')).toBeInTheDocument()
    expect(screen.getByText('rg --files', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('The recorded turn stayed within scope.')).toBeInTheDocument()
    expect(screen.getByText('Evaluation result')).toBeInTheDocument()
    expect(screen.getAllByText('Pass')).toHaveLength(2)
    expect(screen.getByText('The recorded workflow is complete.')).toBeInTheDocument()
    expect(screen.getByText('files read before write')).toBeInTheDocument()
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
    expect(screen.getAllByText('Unmatched event: ObjectID("stop-1").').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('No event locations saved')).toBeInTheDocument()
    expect(screen.getByText('2 occurrences · Warning')).toBeInTheDocument()
    expect(screen.getByText('Review concern')).toBeInTheDocument()
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
    expect(screen.getByText('event id: signal-event-1')).toBeInTheDocument()
    expect(screen.getAllByText('PreToolUse').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Tool started without a completion.')).toBeInTheDocument()
    expect(screen.queryByText('mcp__codex_apps__linear__list_comments')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Evidence type')).toBeInTheDocument()
    expect(screen.getByLabelText('Decision or label')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Decision or label'), { target: { value: 'followsInstructions:no' } })

    expect(screen.getByText('Showing 1 of 2 saved records')).toBeInTheDocument()
    expect(screen.getByText('The turn broke an instruction.')).toBeInTheDocument()
    expect(screen.queryByText('The turn followed instructions.')).not.toBeInTheDocument()
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
    expect(screen.getByText('The current record; revision history is not stored.')).toBeInTheDocument()
    expect(screen.getByLabelText('Saved analysis record').querySelector('time')?.dateTime).toBe('2026-10-24T10:00:00Z')
    expect(screen.getAllByText('1 labeled / 1 captured')).toHaveLength(5)
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
    expect(screen.getByText('npm run build')).toBeInTheDocument()
    expect(screen.getByText('Vite built the frontend.')).toBeInTheDocument()
    expect(screen.getByText('The tool call was recorded, but its completion evidence is incomplete.')).toBeInTheDocument()
    expect(screen.getByText('Improved the forensic evidence layout.')).toBeInTheDocument()
    expect(screen.getByText('.agents/AGENTS.md')).toBeInTheDocument()
    expect(screen.getByText('A tool completion was not captured.')).toBeInTheDocument()
    expect(screen.getByText('The tool result cannot be confirmed.')).toBeInTheDocument()
    expect(screen.getByText('event id: gap-event-1')).toBeInTheDocument()
    expect(screen.getByText('PreToolUse')).toBeInTheDocument()
    expect(screen.getByText('2026-10-24T10:00:00Z')).toBeInTheDocument()
    expect(screen.getByText('The tool invocation has no completion event.')).toBeInTheDocument()
    expect(screen.getByText('Its outcome cannot be verified.')).toBeInTheDocument()
    expect(screen.getByText('Require a completion-event check.')).toBeInTheDocument()
    expect(screen.getByText('Agent instructions')).toBeInTheDocument()
    expect(screen.getAllByText('gap-event-1').length).toBeGreaterThanOrEqual(2)

    fireEvent.change(screen.getByLabelText('Evidence type'), { target: { value: 'turns' } })
    fireEvent.change(screen.getByLabelText('Decision or label'), { target: { value: 'scopeAdherence:deviation' } })
    expect(screen.getByText('Showing 1 of 1 saved records')).toBeInTheDocument()
    expect(screen.getByText('Updated the evaluation interface.')).toBeInTheDocument()
    expect(screen.queryByText('Only change the evaluation page.')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Evidence type'), { target: { value: 'capture_gaps' } })
    expect(screen.getByLabelText('Decision or label')).toBeDisabled()
    expect(screen.getByText('Showing 1 of 1 saved records')).toBeInTheDocument()
    expect(screen.getByText('A tool completion was not captured.')).toBeInTheDocument()
    expect(screen.queryByText('Updated the evaluation interface.')).not.toBeInTheDocument()
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
    expect(screen.getByText('Summary not included in this analysis version.')).toBeInTheDocument()
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
