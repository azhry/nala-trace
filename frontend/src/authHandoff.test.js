import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthHandoffError,
  buildNalaLabsLoginUrl,
  buildNalaLabsLogoutUrl,
  clearNalaLabsAuthCode,
  NALA_LABS_AUTH_CODE_QUERY_PARAM,
  readNalaLabsAuthCode,
  redirectToNalaLabs,
  redeemNalaLabsAuthCode,
  resolveNalaLabsOrigin,
  signOutFromTrace,
  TRACE_HANDOFF_REDEEM_PATH,
} from './authHandoff'
import { clearAuthConfiguration, NALA_LABS_ACCESS_TOKEN_STORAGE_KEY } from './api'

function createWindowHarness(search = '?trace_origin=http%3A%2F%2Flocalhost%3A5005&nala_labs_auth_code=one-time-code') {
  const replaceState = vi.fn()
  const assign = vi.fn()
  return {
    location: {
      origin: 'http://localhost:5005',
      href: `http://localhost:5005/${search}`,
      pathname: '/',
      search,
      hash: '',
      assign,
    },
    history: { state: { page: 'trace' }, replaceState },
    sessionStorage: { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() },
    replaceState,
    assign,
  }
}

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: vi.fn().mockResolvedValue(body) }
}

describe('Nala Labs same-tab authentication handoff', () => {
  beforeEach(() => {
    clearAuthConfiguration()
  })

  it('builds an absolute Nala Labs login URL with only the normalized Trace origin', () => {
    const url = new URL(buildNalaLabsLoginUrl({
      env: { VITE_NALA_LABS_URL: 'https://nala.example.test/login?provider=casdoor' },
      traceOrigin: 'http://localhost:5005/sessions?token=must-not-copy',
    }))

    expect(url.origin).toBe('https://nala.example.test')
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('trace_origin')).toBe('http://localhost:5005')
    expect([...url.searchParams.keys()]).toEqual(['trace_origin'])
    expect(url.searchParams.has('token')).toBe(false)
    expect(url.searchParams.has('password')).toBe(false)
  })

  it('redirects the current tab to Nala Labs', () => {
    const windowRef = createWindowHarness('')

    expect(redirectToNalaLabs({ env: { VITE_NALA_LABS_URL: 'https://nala.example.test/' }, windowRef })).toBe(true)
    expect(windowRef.assign).toHaveBeenCalledExactlyOnceWith(
      'https://nala.example.test/login?trace_origin=http%3A%2F%2Flocalhost%3A5005',
    )
  })

  it('clears the Trace token and stays on a signed-out boundary', () => {
    const windowRef = createWindowHarness('?nala_labs_auth_code=stale-code')

    expect(signOutFromTrace({ windowRef })).toBe(true)
    expect(windowRef.sessionStorage.removeItem).toHaveBeenCalledExactlyOnceWith(NALA_LABS_ACCESS_TOKEN_STORAGE_KEY)
    expect(windowRef.assign).toHaveBeenCalledExactlyOnceWith('http://localhost:5173/login?logout=1')
    expect(buildNalaLabsLogoutUrl()).toBe('http://localhost:5173/login?logout=1')
  })

  it('falls back to the default Nala Labs origin for malformed configuration', () => {
    for (const value of ['not-an-url', 'javascript:alert(1)', 'https://user:password@nala.example.test']) {
      expect(resolveNalaLabsOrigin({ VITE_NALA_LABS_URL: value })).toBe('http://localhost:5173')
    }

    const url = new URL(buildNalaLabsLoginUrl({
      env: { VITE_NALA_LABS_URL: 'javascript:alert(1)' },
      traceOrigin: 'javascript:alert(1)',
    }))
    expect(url.origin).toBe('http://localhost:5173')
    expect([...url.searchParams.keys()]).toEqual([])
  })

  it('reads and clears only the one-time auth code with replaceState', () => {
    const windowRef = createWindowHarness()

    expect(readNalaLabsAuthCode(windowRef)).toBe('one-time-code')
    expect(clearNalaLabsAuthCode(windowRef)).toBe(true)
    expect(windowRef.replaceState).toHaveBeenCalledExactlyOnceWith(
      { page: 'trace' },
      '',
      '/?trace_origin=http%3A%2F%2Flocalhost%3A5005',
    )
    expect(NALA_LABS_AUTH_CODE_QUERY_PARAM).toBe('nala_labs_auth_code')
  })

  it('redeems the code in a POST body before storing the returned bearer token', async () => {
    const windowRef = createWindowHarness()
    const storage = { setItem: vi.fn(), getItem: vi.fn(() => 'jwt-from-nala') }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ token: '  jwt-from-nala  ' }))

    await expect(redeemNalaLabsAuthCode({ windowRef, storage, fetchImpl })).resolves.toEqual({ attempted: true, authenticated: true })

    expect(windowRef.replaceState).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(TRACE_HANDOFF_REDEEM_PATH, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'one-time-code' }),
    })
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(NALA_LABS_ACCESS_TOKEN_STORAGE_KEY, 'jwt-from-nala')
    expect(JSON.stringify(fetchImpl.mock.calls[0])).not.toContain('jwt-from-nala')
  })

  it('does nothing when no handoff code is present', async () => {
    const windowRef = createWindowHarness('')
    const fetchImpl = vi.fn()

    await expect(redeemNalaLabsAuthCode({ windowRef, fetchImpl })).resolves.toEqual({ attempted: false, authenticated: false })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(windowRef.replaceState).not.toHaveBeenCalled()
  })

  it('clears the code before surfacing redemption failures', async () => {
    const windowRef = createWindowHarness()
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'invalid_handoff_code' } }, false, 401))

    await expect(redeemNalaLabsAuthCode({ windowRef, fetchImpl })).rejects.toBeInstanceOf(AuthHandoffError)
    expect(windowRef.replaceState).toHaveBeenCalledOnce()
    expect(windowRef.sessionStorage.setItem).not.toHaveBeenCalled()
  })
})
