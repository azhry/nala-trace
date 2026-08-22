import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAuthConfiguration, configureAuth, getSessions, getTrace, resolveSession } from './api'

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  }
}

describe('API auth configuration', () => {
  beforeEach(() => {
    clearAuthConfiguration()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    clearAuthConfiguration()
    vi.unstubAllGlobals()
  })

  it('preserves cookie-backed requests when no explicit credential is configured', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ authenticated: true }))
    fetch.mockResolvedValueOnce(jsonResponse({ sessions: [], limit: 100 }))
    fetch.mockResolvedValueOnce(jsonResponse({ eventsList: [] }))

    await resolveSession()
    await getSessions()
    await getTrace('session-1')

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/auth/session', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    expect(fetch).toHaveBeenNthCalledWith(2, '/sessions?limit=100', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    expect(fetch).toHaveBeenNthCalledWith(3, '/sessions/session-1', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  })

  it('sends the configured JWT to session resolution and protected calls', async () => {
    configureAuth({ jwt: 'jwt-token' })
    fetch.mockResolvedValueOnce(jsonResponse({ authenticated: true, user: { id: 'user-1' } }))
    fetch.mockResolvedValueOnce(jsonResponse({ sessions: [], limit: 100 }))
    fetch.mockResolvedValueOnce(jsonResponse({ eventsList: [] }))

    await resolveSession()
    await getSessions()
    await getTrace('session-2')

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/auth/session', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer jwt-token',
      },
    })
    expect(fetch).toHaveBeenNthCalledWith(2, '/sessions?limit=100', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer jwt-token',
      },
    })
    expect(fetch).toHaveBeenNthCalledWith(3, '/sessions/session-2', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer jwt-token',
      },
    })
  })

  it('skips session resolution in API-token mode and sends the API key to protected calls', async () => {
    configureAuth({ apiToken: 'api-token' })

    await expect(resolveSession()).resolves.toEqual({
      authenticated: true,
      authenticationMode: 'apiToken',
    })
    expect(fetch).not.toHaveBeenCalled()

    fetch.mockResolvedValueOnce(jsonResponse({ sessions: [], limit: 100 }))
    fetch.mockResolvedValueOnce(jsonResponse({ eventsList: [] }))

    await getSessions()
    await getTrace('session-3')

    expect(fetch).toHaveBeenNthCalledWith(1, '/sessions?limit=100', {
      headers: {
        Accept: 'application/json',
        'X-Nala-Labs-API-Key': 'api-token',
      },
    })
    expect(fetch).toHaveBeenNthCalledWith(2, '/sessions/session-3', {
      headers: {
        Accept: 'application/json',
        'X-Nala-Labs-API-Key': 'api-token',
      },
    })
  })

  it('rejects ambiguous explicit credentials', () => {
    expect(() => configureAuth({ jwt: 'jwt-token', apiToken: 'api-token' })).toThrow('Configure exactly one of jwt or apiToken')
  })
})
