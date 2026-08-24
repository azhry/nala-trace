import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getSessions, getTrace, resolveSession } from './api'
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
    resolveSession.mockResolvedValue({ authenticated: true, user: { id: 'user-1' } })
    getSessions.mockResolvedValue(sessionPayload)
    getTrace.mockResolvedValue({})
  })

  it('links the unauthorized boundary to the default Nala Labs login route', async () => {
    resolveSession.mockRejectedValueOnce(new ApiError('Authentication is required', 401))

    render(<App />)

    expect(await screen.findByRole('link', { name: 'Sign in through Nala Labs' })).toHaveAttribute('href', 'http://localhost:5173/login')
  })

  it('uses VITE_NALA_LABS_URL for the unauthorized login link', async () => {
    vi.stubEnv('VITE_NALA_LABS_URL', 'https://nala.example.test/')
    resolveSession.mockRejectedValueOnce(new ApiError('Authentication is required', 401))

    render(<App />)

    expect(await screen.findByRole('link', { name: 'Sign in through Nala Labs' })).toHaveAttribute('href', 'https://nala.example.test/login')
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
