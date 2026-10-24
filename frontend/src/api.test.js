import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bootstrapAuthFromSessionStorage,
  clearAuthConfiguration,
  configureAuth,
  getSessionAnalysis,
  getSessions,
  getTrace,
  NALA_LABS_ACCESS_TOKEN_STORAGE_KEY,
  resolveSession,
} from './api'

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

  it('fails closed without a credential and never calls the nonexistent auth-session route', async () => {
    await expect(resolveSession()).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Authentication is required',
      status: 401,
    })

    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends the configured JWT to session resolution and protected calls', async () => {
    configureAuth({ jwt: 'jwt-token' })
    fetch.mockResolvedValueOnce(jsonResponse({ sessions: [], limit: 100 }))
    fetch.mockResolvedValueOnce(jsonResponse({ eventsList: [] }))

    await expect(resolveSession()).resolves.toEqual({ authenticated: true, authenticationMode: 'jwt' })
    await getSessions()
    await getTrace('session-2')

    expect(fetch).toHaveBeenNthCalledWith(1, '/sessions?limit=100', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer jwt-token',
      },
    })
    expect(fetch).toHaveBeenNthCalledWith(2, '/sessions/session-2', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer jwt-token',
      },
    })
    expect(fetch).not.toHaveBeenCalledWith('/api/auth/session', expect.anything())
  })

  it('returns the persisted analysis sections from the session-detail response', async () => {
    configureAuth({ jwt: 'jwt-token' })
    const analysis = {
      annotation: null,
      evaluation: {
        schema_version: '1',
        source: 'session-evaluator',
        verdict: 'unknown',
        critique: '',
        review_signals: [],
        judge_alignment: { status: 'not_recorded' },
        evaluation_ledger: { project: 'nala-trace', improvements: [] },
      },
    }
    fetch.mockResolvedValueOnce(jsonResponse({ schema_version: '1', session_id: 'session-analysis', analysis }))

    await expect(getTrace('session-analysis')).resolves.toMatchObject({
      session_id: 'session-analysis',
      analysis,
    })
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/sessions/session-analysis', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer jwt-token',
      },
    })
  })

  it('reads saved analysis from its independent compact endpoint', async () => {
    configureAuth({ jwt: 'jwt-token' })
    const payload = {
      session_id: 'session/analysis',
      analysis: {
        updated_at: '2026-10-24T12:00:00Z',
        annotation: { schema_version: '2', user_turns: [], turns: [], tools: [], skills: [], files: [], capture_gaps: [] },
        evaluation: { schema_version: '2', verdict: 'unknown', review_signals: [] },
      },
    }
    fetch.mockResolvedValueOnce(jsonResponse(payload))

    await expect(getSessionAnalysis('session/analysis')).resolves.toEqual(payload)

    expect(fetch).toHaveBeenCalledExactlyOnceWith('/sessions/session%2Fanalysis/analysis', {
      headers: { Accept: 'application/json', Authorization: 'Bearer jwt-token' },
    })
  })

  it('bootstraps the approved same-origin session token into JWT mode', async () => {
    const storage = { getItem: vi.fn(() => 'stored-jwt') }
    expect(bootstrapAuthFromSessionStorage(storage)).toBe(true)
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(NALA_LABS_ACCESS_TOKEN_STORAGE_KEY)

    fetch.mockResolvedValueOnce(jsonResponse({ sessions: [], limit: 100 }))

    await expect(resolveSession()).resolves.toEqual({ authenticated: true, authenticationMode: 'jwt' })
    await getSessions()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/sessions?limit=100', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer stored-jwt',
      },
    })
  })

  it('does not replace an explicit API-token configuration during bootstrap', async () => {
    configureAuth({ apiToken: 'api-token' })

    expect(bootstrapAuthFromSessionStorage({ getItem: vi.fn(() => 'stored-jwt') })).toBe(false)
    await expect(resolveSession()).resolves.toEqual({ authenticated: true, authenticationMode: 'apiToken' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', { getItem: vi.fn(() => null) }],
    ['unavailable', { getItem: vi.fn(() => { throw new Error('storage unavailable') }) }],
  ])('keeps the default auth mode when session storage is %s', async (_state, storage) => {
    expect(bootstrapAuthFromSessionStorage(storage)).toBe(false)

    await expect(resolveSession()).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Authentication is required',
      status: 401,
    })

    expect(fetch).not.toHaveBeenCalled()
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
    fetch.mockResolvedValueOnce(jsonResponse({ session_id: 'session-3', analysis: {} }))

    await getSessions()
    await getTrace('session-3')
    await getSessionAnalysis('session-3')

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
    expect(fetch).toHaveBeenNthCalledWith(3, '/sessions/session-3/analysis', {
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
