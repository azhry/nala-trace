import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, clearAuthConfiguration, getSessionAnalysis, getSessions, getTrace, NALA_LABS_ACCESS_TOKEN_STORAGE_KEY, resolveSession } from './api'
import { redirectToNalaLabs, redeemNalaLabsAuthCode, signOutFromTrace } from './authHandoff'
import App, { TRACE_LOADING_MIN_DURATION_MS } from './App'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getSessionAnalysis: vi.fn(),
    getSessions: vi.fn(),
    getTrace: vi.fn(),
    resolveSession: vi.fn(),
  }
})

vi.mock('./authHandoff', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    redirectToNalaLabs: vi.fn(),
    redeemNalaLabsAuthCode: vi.fn(),
    signOutFromTrace: vi.fn(),
  }
})

const sessionPayload = {
  sessions: [{
    session_id: 'authenticated-session',
    first_event_at: '2026-08-19T08:00:00Z',
    last_event_at: '2026-08-19T08:05:00Z',
    event_count: 3,
    tool_call_count: 1,
    mcp_call_count: 2,
    mcp_servers: ['github', 'linear'],
    skill_invocation_count: 0,
    file_operation_count: 0,
  }],
  limit: 100,
}

const apiTracePayload = {
  schema_version: '1',
  session_id: 'authenticated-session',
  user_id: 'user-1',
  timeline: [],
  conversation: [
    {
      role: 'user',
      content: 'Show the recorded conversation.',
      occurred_at: '2026-08-19T08:00:00Z',
      turn_id: 'turn-1',
      raw: {},
    },
    {
      role: 'assistant',
      content: { result: 'ordered and safe' },
      occurred_at: '2026-08-19T08:00:02Z',
      turn_id: 'turn-1',
      raw: {},
    },
    {
      role: 'user',
      content: 'Keep the next turn visible.',
      occurred_at: '2026-08-19T08:01:00Z',
      turn_id: 'turn-2',
      raw: {},
    },
  ],
  tool_calls: [],
  skill_invocations: [],
  files: [],
  summary: { event_count: 3, message_count: 3, tool_call_count: 0 },
}

const paginatedTraceEvents = Array.from({ length: 101 }, (_, index) => ({
  id: `page-event-${index}`,
  hook_event_name: index === 0 || index === 100 ? 'UserPromptSubmit' : 'SessionStart',
  occurred_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  turn_id: `turn-${index}`,
  index,
  content: index === 100 ? 'Next page event' : `Initial page event ${index}`,
}))

function paginatedTracePage(offset) {
  const events = paginatedTraceEvents.slice(offset, offset + 100)
  return {
    ...apiTracePayload,
    timeline: events.map(({ id, hook_event_name, occurred_at, turn_id }) => ({ id, hook_event_name, occurred_at, turn_id, raw: {} })),
    conversation: events.filter((event) => event.index === 0 || event.index === 100).map(({ id, content, occurred_at, turn_id }) => ({
      event_id: id,
      role: 'user',
      content,
      occurred_at,
      turn_id,
      raw: { hook_event_name: 'UserPromptSubmit' },
    })),
    tool_calls: [],
    skill_invocations: [],
    files: [],
    summary: { event_count: 101, message_count: 101, tool_call_count: 9, skill_invocation_count: 8 },
    pagination: { offset, limit: 100, total: 101, has_more: offset + events.length < 101 },
  }
}

describe('authenticated sessions flow', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/#/sessions')
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    clearAuthConfiguration()
    window.sessionStorage.clear()
    window.sessionStorage.setItem(NALA_LABS_ACCESS_TOKEN_STORAGE_KEY, 'test-jwt')
    redirectToNalaLabs.mockReturnValue(true)
    signOutFromTrace.mockReturnValue(true)
    redeemNalaLabsAuthCode.mockResolvedValue({ attempted: false, authenticated: false })
    resolveSession.mockResolvedValue({ authenticated: true, user: { id: 'user-1' } })
    getSessions.mockResolvedValue(sessionPayload)
    getSessionAnalysis.mockResolvedValue({ session_id: 'authenticated-session', analysis: null })
    getTrace.mockResolvedValue({})
  })

  it('automatically redirects an unauthorized entry to Nala Labs in the same tab', async () => {
    window.sessionStorage.removeItem(NALA_LABS_ACCESS_TOKEN_STORAGE_KEY)
    resolveSession.mockRejectedValueOnce(new ApiError('Authentication is required', 401))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Sign in through Nala Labs' })).toBeInTheDocument()
    await waitFor(() => expect(redirectToNalaLabs).toHaveBeenCalledExactlyOnceWith())
  })

  it('keeps the auth boundary for an invalid stored credential', async () => {
    resolveSession.mockRejectedValueOnce(new ApiError('Authentication is required', 401))

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in through Nala Labs')
    await waitFor(() => expect(redirectToNalaLabs).toHaveBeenCalledExactlyOnceWith())
  })

  it('keeps a manual same-tab sign-in button as the fallback', async () => {
    resolveSession.mockRejectedValueOnce(new ApiError('Authentication is required', 401))

    render(<App />)

    await screen.findByRole('button', { name: 'Sign in through Nala Labs' })
    await waitFor(() => expect(redirectToNalaLabs).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Sign in through Nala Labs' }))
    expect(redirectToNalaLabs).toHaveBeenCalledTimes(2)
  })

  it('redeems a returned code before resolving the protected session', async () => {
    window.history.replaceState({}, '', '/?nala_labs_auth_code=opaque-code')
    window.location.hash = '#/sessions'
    redeemNalaLabsAuthCode.mockResolvedValueOnce({ attempted: true, authenticated: true })

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Open session authenticated-session' })).toBeInTheDocument()
    expect(redeemNalaLabsAuthCode.mock.invocationCallOrder[0]).toBeLessThan(resolveSession.mock.invocationCallOrder[0])
    expect(getSessions).toHaveBeenCalledExactlyOnceWith()
  })

  it('shows a Trace sign-out control for authenticated sessions', async () => {
    render(<App />)

    await screen.findByRole('button', { name: 'Sign out' })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOutFromTrace).toHaveBeenCalledExactlyOnceWith()
  })

  it('keeps the full sessions shell while authentication is unresolved', async () => {
    let resolveAuthentication
    resolveSession.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAuthentication = resolve
    }))

    render(<App />)

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'All captured sessions' })).toBeInTheDocument()
    const loadingStatus = document.querySelector('.trace-loading-panel')
    expect(loadingStatus).toBeInTheDocument()
    expect(loadingStatus).toHaveTextContent('Loading sessions…')
    expect(loadingStatus).toHaveTextContent('Resolving your application session before reading Trace records.')
    expect(loadingStatus).toHaveAttribute('aria-busy', 'true')
    expect(loadingStatus).toHaveClass('trace-loading-panel')
    expect(loadingStatus.querySelector('.trace-loader-mark')).toBeInTheDocument()
    expect(loadingStatus.querySelector('.trace-loading-skeletons')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in through Nala Labs' })).not.toBeInTheDocument()
    expect(document.querySelector('.auth-boundary')).not.toBeInTheDocument()

    await waitFor(() => expect(resolveAuthentication).toBeTypeOf('function'))
    resolveAuthentication({ authenticated: true, user: { id: 'user-1' } })

    expect(await screen.findByRole('button', { name: 'Open session authenticated-session' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('does not gate refresh entry on session storage before auth resolution', async () => {
    window.sessionStorage.clear()
    let resolveAuthentication
    resolveSession.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAuthentication = resolve
    }))

    render(<App />)

    const loadingStatus = document.querySelector('.trace-loading-panel')
    expect(loadingStatus).toHaveClass('trace-loading-panel')
    expect(loadingStatus.querySelector('.trace-loader-mark')).toBeInTheDocument()
    expect(loadingStatus.querySelector('.trace-loading-skeletons')).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'All captured sessions' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in through Nala Labs' })).not.toBeInTheDocument()
    expect(redirectToNalaLabs).not.toHaveBeenCalled()

    await waitFor(() => expect(resolveAuthentication).toBeTypeOf('function'))
    resolveAuthentication({ authenticated: true, user: { id: 'user-1' } })
    expect(await screen.findByRole('button', { name: 'Open session authenticated-session' })).toBeInTheDocument()
  })

  it('keeps the full detail shell while initial authentication is unresolved', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session')
    getTrace.mockResolvedValueOnce(apiTracePayload)
    let resolveAuthentication
    resolveSession.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAuthentication = resolve
    }))

    render(<App />)

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /All sessions/ })).toBeInTheDocument()
    expect(screen.getByText('Session detail', { selector: 'p' })).toBeInTheDocument()
    const loadingStatus = document.querySelector('.trace-loading-panel')
    expect(loadingStatus).toBeInTheDocument()
    expect(loadingStatus.querySelector('.trace-loader-mark')).toBeInTheDocument()
    expect(loadingStatus.querySelector('.trace-loading-skeletons')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in through Nala Labs' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Recorded execution settings' })).not.toBeInTheDocument()
    expect(getSessions).not.toHaveBeenCalled()

    await waitFor(() => expect(resolveAuthentication).toBeTypeOf('function'))
    resolveAuthentication({ authenticated: true, user: { id: 'user-1' } })
    expect(await screen.findByText('Show the recorded conversation.')).toBeInTheDocument()
  })

  it('shows the sign-in boundary and retry when authentication is unauthorized', async () => {
    resolveSession.mockRejectedValueOnce(new ApiError('Authentication is required', 401))

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in through Nala Labs')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'All captured sessions' })).not.toBeInTheDocument()
  })

  it('resolves the application session before requesting GET /sessions', async () => {
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Open session authenticated-session' })).toBeInTheDocument()
    expect(resolveSession.mock.invocationCallOrder[0]).toBeLessThan(getSessions.mock.invocationCallOrder[0])
  })

  it('shows aggregate MCP calls and unique servers in workspace stats', async () => {
    render(<App />)

    await screen.findByRole('button', { name: 'Open session authenticated-session' })

    expect(screen.getByText('MCP calls')).toBeInTheDocument()
    expect(screen.getByText('2 unique servers')).toBeInTheDocument()
    expect(screen.getByText('MCP: github · linear')).toBeInTheDocument()
  })

  it('keeps row selection addressable through the hash route', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open session authenticated-session' }))
    await waitFor(() => expect(window.location.hash).toBe('#/sessions/authenticated-session'))
  })

  it('renders the empty, unauthorized, and API-error response states', async () => {
    getSessions.mockResolvedValueOnce({ sessions: [], limit: 100 })
    const { unmount } = render(<App />)
    expect(await screen.findByText('No sessions captured yet.')).toBeInTheDocument()
    unmount()

    resolveSession.mockRejectedValueOnce(new ApiError('Authentication is required', 401))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in through Nala Labs')

    resolveSession.mockResolvedValueOnce({ authenticated: true })
    getSessions.mockRejectedValueOnce(new ApiError('Request failed', 503))
    render(<App />)
    await waitFor(() => expect(screen.getAllByText('Sessions could not be loaded.').length).toBeGreaterThan(0))
  })

  it('hands the API-shaped trace payload to the conversation view in order', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session')
    getTrace.mockResolvedValueOnce(apiTracePayload)

    render(<App />)

    expect(await screen.findByText('Show the recorded conversation.')).toBeInTheDocument()
    expect(screen.getByText('Keep the next turn visible.')).toBeInTheDocument()
    expect(screen.getByText('turn turn-2')).toBeInTheDocument()
    expect(getTrace).toHaveBeenCalledExactlyOnceWith('authenticated-session', { offset: 0, limit: 100 })
  })

  it('requests and appends the next trace page only after the user asks, keeping whole-session totals', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session')
    const firstPage = paginatedTracePage(0)
    const nextPage = paginatedTracePage(100)
    nextPage.timeline.unshift(firstPage.timeline[99])
    nextPage.conversation.unshift(firstPage.conversation[0])
    getTrace.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(nextPage)

    const { container } = render(<App />)

    expect(await screen.findByText('Initial page event 0')).toBeInTheDocument()
    expect(screen.queryByText('Next page event')).not.toBeInTheDocument()
    expect(getTrace).toHaveBeenCalledExactlyOnceWith('authenticated-session', { offset: 0, limit: 100 })
    expect(screen.getByText('Loaded 100 of 101 captured events · 100 rows shown.')).toBeInTheDocument()
    expect(container.querySelector('.trace-summary > div:first-child strong')).toHaveTextContent('8')
    expect(container.querySelector('.trace-summary > div:nth-child(2) strong')).toHaveTextContent('9')

    fireEvent.click(screen.getByRole('button', { name: 'Load more rows' }))

    await waitFor(() => expect(getTrace).toHaveBeenNthCalledWith(2, 'authenticated-session', { offset: 100, limit: 100 }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await screen.findByText('Next page event')).toBeInTheDocument()
    expect(container.querySelector('.trace-stream-pagination [role="status"]').textContent).toBe('Loaded 101 of 101 captured events · 101 rows shown.')
    expect(getTrace).toHaveBeenNthCalledWith(2, 'authenticated-session', { offset: 100, limit: 100 })
    expect(screen.getAllByText('Initial page event 0')).toHaveLength(1)
    expect(container.querySelectorAll('[data-trace-event-id="page-event-99"]')).toHaveLength(1)
    expect(container.querySelector('.trace-summary > div:first-child strong')).toHaveTextContent('8')
    expect(container.querySelector('.trace-summary > div:nth-child(2) strong')).toHaveTextContent('9')
  }, 15000)

  it('keeps paired tool calls intact when a completion hook arrives on the next page', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session')
    const firstPage = paginatedTracePage(0)
    firstPage.timeline[0] = { id: 'first-tool-start', hook_event_name: 'PreToolUse', tool_call_index: 0, raw: {} }
    firstPage.tool_calls = [{ tool_use_id: 'first-tool', tool_name: 'shell_command', input: { command: 'first' }, output: 'completed first', status: 'completed' }]
    firstPage.summary = { ...firstPage.summary, event_count: 102, tool_call_count: 9 }
    firstPage.pagination = { ...firstPage.pagination, total: 102, has_more: true }

    const nextPage = paginatedTracePage(100)
    nextPage.timeline = [
      { id: 'next-tool-start', hook_event_name: 'PreToolUse', tool_call_index: 10, raw: {} },
      { id: 'first-tool-completion', hook_event_name: 'PostToolUse', tool_call_index: 0, raw: {} },
    ]
    nextPage.tool_calls = [{ tool_use_id: 'next-tool', tool_name: 'shell_command', input: { command: 'next' }, output: 'completed next', status: 'completed' }]
    nextPage.summary = { ...firstPage.summary, event_count: 102, tool_call_count: 9 }
    nextPage.pagination = { offset: 100, limit: 100, total: 102, has_more: false }
    getTrace.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(nextPage)

    const { container } = render(<App />)

    expect(await screen.findByText('Initial page event 0')).toBeInTheDocument()
    expect(container.querySelectorAll('.tool-card')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Load more rows' }))

    expect(await screen.findByText('Next page event')).toBeInTheDocument()
    expect(container.querySelectorAll('.tool-card')).toHaveLength(2)
    expect(screen.queryByText('PreToolUse')).not.toBeInTheDocument()
    expect(screen.queryByText('PostToolUse')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.tool-card-status')).toHaveLength(2)
    expect([...container.querySelectorAll('.tool-card-status')].every((status) => status.textContent.includes('completed'))).toBe(true)
  })

  it('keeps loaded trace rows visible when a page fails and retries the same offset', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session')
    getTrace.mockResolvedValueOnce(paginatedTracePage(0))
      .mockRejectedValueOnce(new ApiError('Request failed', 503))
      .mockResolvedValueOnce(paginatedTracePage(100))

    render(<App />)

    expect(await screen.findByText('Initial page event 0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more rows' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The next page could not be loaded.')
    expect(screen.getByText('Initial page event 0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading more rows' }))

    expect(await screen.findByText('Next page event')).toBeInTheDocument()
    expect(getTrace).toHaveBeenNthCalledWith(2, 'authenticated-session', { offset: 100, limit: 100 })
    expect(getTrace).toHaveBeenNthCalledWith(3, 'authenticated-session', { offset: 100, limit: 100 })
  }, 15000)

  it('renders persisted session analysis from the live detail response', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session')
    getTrace.mockResolvedValueOnce({
      ...apiTracePayload,
      analysis: {
        annotation: {
          schema_version: '1',
          source: 'session-annotator',
          turns: [{ event_id: 'stop-1', turn_id: 'turn-1', follows_instructions: 'yes', performance: 'improved', rationale: 'The recorded turn followed the task.' }],
          tools: [],
          skills: [],
        },
        evaluation: {
          schema_version: '1',
          source: 'session-evaluator',
          verdict: 'fail',
          critique: 'The evaluator recorded a review concern.',
          review_signals: [{ name: 'review required', count: 1, severity: 'warning', detail: 'One concern was recorded.' }],
          judge_alignment: { status: 'not_recorded' },
          evaluation_ledger: { project: 'nala-trace', improvements: [] },
        },
      },
    })

    render(<App />)

    expect(await screen.findByText('Evaluation summary')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open full evaluation' })).toHaveAttribute('href', '#/sessions/authenticated-session/evaluation')
    expect(screen.getByText('Fail')).toBeInTheDocument()
    expect(screen.queryByText('The evaluator recorded a review concern.')).not.toBeInTheDocument()
  })

  it('shows an annotation and evaluation link beside the session title', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session')
    getTrace.mockResolvedValueOnce(apiTracePayload)

    render(<App />)

    const title = await screen.findByRole('heading', { level: 1 })
    const evaluationLink = await screen.findByRole('link', { name: 'View annotation and evaluation' })

    expect(evaluationLink).toBeVisible()
    expect(title.parentElement).toContainElement(evaluationLink)
    expect(evaluationLink).toHaveAttribute('href', '#/sessions/authenticated-session/evaluation')
  })

  it('opens the full evaluation review on its dedicated route', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session/evaluation')
    getSessionAnalysis.mockResolvedValueOnce({
      session_id: 'authenticated-session',
      analysis: {
        annotation: {
          schema_version: '1',
          source: 'session-annotator',
          turns: [{ event_id: 'stop-1', turn_id: 'turn-1', follows_instructions: 'yes', performance: 'improved', rationale: 'The recorded turn followed the task.' }],
          tools: [],
          skills: [],
        },
        evaluation: {
          schema_version: '1',
          source: 'session-evaluator',
          verdict: 'fail',
          critique: 'The evaluator recorded a review concern.',
          review_signals: [{ name: 'review required', count: 1, severity: 'warning', detail: 'One concern was recorded.' }],
          judge_alignment: { status: 'not_recorded' },
          evaluation_ledger: { project: 'nala-trace', improvements: [] },
        },
      },
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session evaluation', level: 1 })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Review details' })).toBeInTheDocument()
    expect(await screen.findByText('The evaluator recorded a review concern.')).toBeInTheDocument()
    expect(screen.getAllByText('review required').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('heading', { name: 'Evaluation summary' })).not.toBeInTheDocument()
    expect(getSessionAnalysis).toHaveBeenCalledExactlyOnceWith('authenticated-session')
    expect(getTrace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '← Session detail' }))
    await waitFor(() => expect(window.location.hash).toBe('#/sessions/authenticated-session'))
  })

  it('opens a saved occurrence in the paginated trace only after the reviewer follows its link', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session/evaluation')
    getSessionAnalysis.mockResolvedValueOnce({
      session_id: 'authenticated-session',
      analysis: {
        annotation: { schema_version: '2', turns: [] },
        evaluation: {
          schema_version: '2',
          verdict: 'fail',
          critique: 'One captured event needs review.',
          review_signals: [{
            name: 'missing_user_context',
            count: 1,
            severity: 'warning',
            detail: 'A prompt record needs inspection.',
            occurrences: [{
              event_id: 'ObjectID("page-event-100")',
              event_kind: 'UserPromptSubmit',
              occurred_at: '2026-01-01T01:40:00.000Z',
              summary: 'Next page event',
              impact: 'The referenced user request needs review.',
            }],
          }],
          evaluation_ledger: { project: 'nala-trace', improvements: [] },
        },
      },
    })
    getTrace.mockResolvedValueOnce(paginatedTracePage(0)).mockResolvedValueOnce(paginatedTracePage(100))

    const { container } = render(<App />)

    expect(await screen.findByRole('heading', { name: 'Priority findings' })).toBeInTheDocument()
    const traceLink = screen.getAllByRole('link', { name: 'Open full record in session trace' })[0]
    expect(traceLink).toHaveAttribute('href', '#/sessions/authenticated-session?event=page-event-100')
    expect(getSessionAnalysis).toHaveBeenCalledExactlyOnceWith('authenticated-session')
    expect(getTrace).not.toHaveBeenCalled()

    fireEvent.click(traceLink)

    await waitFor(() => expect(window.location.hash).toBe('#/sessions/authenticated-session?event=page-event-100'))
    await waitFor(() => expect(getTrace).toHaveBeenNthCalledWith(1, 'authenticated-session', expect.objectContaining({ offset: 0 })))
    await waitFor(() => expect(getTrace).toHaveBeenNthCalledWith(2, 'authenticated-session', expect.objectContaining({ offset: 100 })))
    expect(await screen.findByText('Next page event')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('[data-trace-event-active="true"]')).toBeInTheDocument())
  })

  it('shows separate loading, failure, retry, and empty states without requesting the full trace', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session/evaluation')
    let rejectAnalysis
    getSessionAnalysis.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectAnalysis = reject }))

    render(<App />)

    await waitFor(() => expect(getSessionAnalysis).toHaveBeenCalledExactlyOnceWith('authenticated-session'))
    expect(await screen.findByText('Loading saved evaluation')).toBeInTheDocument()
    await act(async () => rejectAnalysis(new ApiError('analysis failed', 500)))
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved evaluation could not be loaded')
    fireEvent.click(screen.getByRole('button', { name: 'Retry analysis request' }))
    expect(await screen.findByText('No analysis saved')).toBeInTheDocument()
    expect(getSessionAnalysis).toHaveBeenCalledTimes(2)
    expect(getTrace).not.toHaveBeenCalled()
  })

  it('shows an accessible stable loader during the initial detail request', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session')
    let resolveTrace
    getTrace.mockImplementationOnce(() => new Promise((resolve) => {
      resolveTrace = resolve
    }))

    render(<App />)

    await waitFor(() => expect(getTrace).toHaveBeenCalledExactlyOnceWith('authenticated-session', { offset: 0, limit: 100 }))
    const loadingStatus = screen.getByRole('status')
    expect(loadingStatus).toHaveTextContent('Loading trace conversation…')
    expect(loadingStatus).toHaveAttribute('aria-busy', 'true')
    expect(loadingStatus.querySelector('.trace-loader-mark')).toBeInTheDocument()

    resolveTrace(apiTracePayload)
    expect(await screen.findByText('Show the recorded conversation.')).toBeInTheDocument()
  })

  it('does not render completed detail sections while the trace is loading', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session')
    let resolveTrace
    getTrace.mockImplementationOnce(() => new Promise((resolve) => {
      resolveTrace = resolve
    }))

    render(<App />)

    await waitFor(() => expect(getTrace).toHaveBeenCalledExactlyOnceWith('authenticated-session', { offset: 0, limit: 100 }))
    const loadingStatus = screen.getByRole('status')

    expect(loadingStatus).toHaveClass('trace-loading-panel')
    expect(screen.queryByRole('heading', { name: 'Recorded execution settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Session detail', level: 2 })).not.toBeInTheDocument()

    resolveTrace(apiTracePayload)
    expect(await screen.findByText('Show the recorded conversation.')).toBeInTheDocument()
  })

  it('keeps a fast detail response loading for the minimum visible duration', async () => {
    vi.useFakeTimers()
    try {
      window.history.replaceState({}, '', '/#/sessions/authenticated-session')
      getTrace.mockResolvedValueOnce(apiTracePayload)

      render(<App />)

      await act(async () => { await Promise.resolve() })
      expect(getTrace).toHaveBeenCalledExactlyOnceWith('authenticated-session', { offset: 0, limit: 100 })
      expect(screen.getByText('Loading trace conversation…')).toBeInTheDocument()

      await act(async () => { await vi.advanceTimersByTimeAsync(TRACE_LOADING_MIN_DURATION_MS - 1) })
      expect(screen.getByText('Loading trace conversation…')).toBeInTheDocument()

      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(screen.getByText('Show the recorded conversation.')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a delayed trace response after leaving the detail route', async () => {
    vi.useFakeTimers()
    try {
      window.history.replaceState({}, '', '/#/sessions/authenticated-session')
      getTrace.mockResolvedValueOnce(apiTracePayload)

      render(<App />)

      await act(async () => { await Promise.resolve() })
      expect(screen.getByText('Loading trace conversation…')).toBeInTheDocument()

      window.history.replaceState({}, '', '/#/sessions')
      fireEvent(window, new Event('hashchange'))
      await act(async () => { await vi.advanceTimersByTimeAsync(TRACE_LOADING_MIN_DURATION_MS) })

      expect(screen.getByRole('heading', { name: 'All captured sessions' })).toBeInTheDocument()
      expect(screen.queryByText('Show the recorded conversation.')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the detail surface visibly loading during a route transition', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session')
    const secondSession = {
      session_id: 'second-session',
      first_event_at: '2026-08-19T09:00:00Z',
      last_event_at: '2026-08-19T09:05:00Z',
      event_count: 2,
      tool_call_count: 1,
      skill_invocation_count: 0,
      file_operation_count: 0,
    }
    const secondTrace = {
      ...apiTracePayload,
      session_id: 'second-session',
      conversation: [{
        role: 'user',
        content: 'Second session content.',
        occurred_at: '2026-08-19T09:00:00Z',
        turn_id: 'turn-2',
        raw: {},
      }],
    }
    let resolveSecondTrace
    getSessions.mockResolvedValueOnce({ ...sessionPayload, sessions: [...sessionPayload.sessions, secondSession] })
    getTrace.mockResolvedValueOnce(apiTracePayload)
    getTrace.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSecondTrace = resolve
    }))

    render(<App />)

    expect(await screen.findByText('Show the recorded conversation.')).toBeInTheDocument()
    window.history.replaceState({}, '', '/#/sessions/second-session')
    fireEvent(window, new Event('hashchange'))

    expect(screen.getByText('Loading trace conversation…')).toBeInTheDocument()
    expect(screen.queryByText('Show the recorded conversation.')).not.toBeInTheDocument()

    resolveSecondTrace(secondTrace)
    expect(await screen.findByText('Second session content.')).toBeInTheDocument()
  })

  it('shows a missing trace state and retries the selected session request', async () => {
    window.history.replaceState({}, '', '/#/sessions/authenticated-session')
    getTrace.mockRejectedValueOnce(new ApiError('trace not found', 404, { code: 'trace_not_found' }))
    getTrace.mockResolvedValueOnce(apiTracePayload)

    render(<App />)

    expect(await screen.findByText('Session trace not found.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry request' }))
    expect(await screen.findByText('Show the recorded conversation.')).toBeInTheDocument()
    expect(getTrace).toHaveBeenCalledTimes(2)
  })
})
