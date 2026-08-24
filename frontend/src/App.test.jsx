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
    skill_invocation_count: 0,
    file_operation_count: 0,
  }],
  limit: 100,
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
    expect(redirectToNalaLabs).toHaveBeenCalledExactlyOnceWith()
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
})
