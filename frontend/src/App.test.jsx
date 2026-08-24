import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, clearAuthConfiguration, getSessions, getTrace, resolveSession } from './api'
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
    window.location.hash = '#/sessions'
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    clearAuthConfiguration()
    window.sessionStorage.clear()
    resolveSession.mockResolvedValue({ authenticated: true, user: { id: 'user-1' } })
    getSessions.mockResolvedValue(sessionPayload)
    getTrace.mockResolvedValue({})
  })

  it('opens the configured Nala Labs login popup and retries after a valid handoff', async () => {
    vi.stubEnv('VITE_NALA_LABS_URL', 'https://nala.example.test/')
    resolveSession.mockRejectedValueOnce(new ApiError('Authentication is required', 401))
    const popup = { closed: false }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup)

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in through Nala Labs' }))

    expect(open).toHaveBeenCalledExactlyOnceWith(
      `https://nala.example.test/login?trace_origin=${encodeURIComponent(window.location.origin)}`,
      'nala-labs-login',
      'popup,width=480,height=720',
    )

    const message = new Event('message')
    Object.defineProperties(message, {
      origin: { value: 'https://nala.example.test' },
      source: { value: popup },
      data: { value: { type: 'nala-labs-authenticated', token: 'jwt-from-nala' } },
    })
    act(() => window.dispatchEvent(message))

    expect(await screen.findByRole('button', { name: 'Open session authenticated-session' })).toBeInTheDocument()
    expect(getSessions).toHaveBeenCalledExactlyOnceWith()
    expect(window.sessionStorage.getItem('nala_labs_access_token')).toBe('jwt-from-nala')
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
