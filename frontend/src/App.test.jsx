import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, clearAuthConfiguration, getSessions, getTrace, NALA_LABS_ACCESS_TOKEN_STORAGE_KEY, resolveSession } from './api'
import { redirectToNalaLabs, redeemNalaLabsAuthCode, signOutFromTrace } from './authHandoff'
import App from './App'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
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
    getTrace.mockResolvedValue({})
  })

  it('automatically redirects an unauthorized entry to Nala Labs in the same tab', async () => {
    window.sessionStorage.removeItem(NALA_LABS_ACCESS_TOKEN_STORAGE_KEY)

    render(<App />)

    await waitFor(() => expect(redirectToNalaLabs).toHaveBeenCalledExactlyOnceWith())
    expect(screen.queryByRole('heading', { name: 'Sign in through Nala Labs' })).not.toBeInTheDocument()
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

  it('hides the dashboard shell while authentication and protected data are unresolved', async () => {
    let resolveAuthentication
    resolveSession.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAuthentication = resolve
    }))

    render(<App />)

    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'All captured sessions' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Sign in through Nala Labs')

    await waitFor(() => expect(resolveAuthentication).toBeTypeOf('function'))
    resolveAuthentication({ authenticated: true, user: { id: 'user-1' } })

    expect(await screen.findByRole('button', { name: 'Open session authenticated-session' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
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
    expect(getTrace).toHaveBeenCalledExactlyOnceWith('authenticated-session')
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
