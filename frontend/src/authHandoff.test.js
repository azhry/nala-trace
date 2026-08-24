import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildNalaLabsLoginUrl,
  createNalaLabsAuthHandoff,
  NALA_LABS_AUTH_MESSAGE_TYPE,
} from './authHandoff'
import { clearAuthConfiguration } from './api'

function createWindowHarness(popup) {
  const listeners = new Map()
  return {
    location: { origin: 'http://localhost:5005' },
    open: vi.fn(() => popup),
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type)
    }),
    dispatchMessage(event) {
      return listeners.get('message')?.(event)
    },
  }
}

describe('Nala Labs authentication handoff', () => {
  beforeEach(() => {
    clearAuthConfiguration()
  })

  it('builds the login URL with only the non-secret Trace origin', () => {
    const url = new URL(buildNalaLabsLoginUrl({
      env: { VITE_NALA_LABS_URL: 'https://nala.example.test/' },
      traceOrigin: 'http://localhost:5005',
    }))

    expect(url.origin).toBe('https://nala.example.test')
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('trace_origin')).toBe('http://localhost:5005')
    expect(url.searchParams.has('token')).toBe(false)
    expect(url.searchParams.has('password')).toBe(false)
  })

  it('accepts only the expected origin, popup source, type, and non-empty token', () => {
    const popup = { name: 'nala-login-popup' }
    const storage = { setItem: vi.fn() }
    const onAuthenticated = vi.fn()
    const windowRef = createWindowHarness(popup)
    const handoff = createNalaLabsAuthHandoff({
      env: { VITE_NALA_LABS_URL: 'https://nala.example.test' },
      windowRef,
      storage,
      onAuthenticated,
    })

    expect(handoff.open()).toBe(popup)
    expect(windowRef.open).toHaveBeenCalledExactlyOnceWith(
      'https://nala.example.test/login?trace_origin=http%3A%2F%2Flocalhost%3A5005',
      'nala-labs-login',
      'popup,width=480,height=720',
    )

    const rejectedMessages = [
      { origin: 'https://evil.example.test', source: popup, data: { type: NALA_LABS_AUTH_MESSAGE_TYPE, token: 'jwt' } },
      { origin: 'https://nala.example.test', source: {}, data: { type: NALA_LABS_AUTH_MESSAGE_TYPE, token: 'jwt' } },
      { origin: 'https://nala.example.test', source: popup, data: { type: 'unexpected', token: 'jwt' } },
      { origin: 'https://nala.example.test', source: popup, data: { type: NALA_LABS_AUTH_MESSAGE_TYPE, token: '   ' } },
      { origin: 'https://nala.example.test', source: popup, data: { type: NALA_LABS_AUTH_MESSAGE_TYPE, token: 123 } },
    ]

    for (const event of rejectedMessages) expect(windowRef.dispatchMessage(event)).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(onAuthenticated).not.toHaveBeenCalled()

    expect(windowRef.dispatchMessage({
      origin: 'https://nala.example.test',
      source: popup,
      data: { type: NALA_LABS_AUTH_MESSAGE_TYPE, token: '  jwt-from-nala  ' },
    })).toBe(true)
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith('nala_labs_access_token', 'jwt-from-nala')
    expect(onAuthenticated).toHaveBeenCalledExactlyOnceWith()
    expect(windowRef.removeEventListener).toHaveBeenCalledOnce()
  })

  it('reports a blocked popup without installing a message listener', () => {
    const onPopupBlocked = vi.fn()
    const windowRef = createWindowHarness(null)
    const handoff = createNalaLabsAuthHandoff({ windowRef, onPopupBlocked })

    expect(handoff.open()).toBeNull()
    expect(onPopupBlocked).toHaveBeenCalledExactlyOnceWith()
    expect(windowRef.addEventListener).not.toHaveBeenCalled()
  })
})
