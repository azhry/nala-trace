import { bootstrapAuthFromSessionStorage, clearAuthConfiguration, NALA_LABS_ACCESS_TOKEN_STORAGE_KEY } from './api'

export const DEFAULT_NALA_LABS_ORIGIN = 'http://localhost:5173'
export const NALA_LABS_AUTH_CODE_QUERY_PARAM = 'nala_labs_auth_code'
export const TRACE_HANDOFF_REDEEM_PATH = '/api/auth/trace-handoff/redeem'

export class AuthHandoffError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'AuthHandoffError'
    this.status = status
  }
}

function getLocationOrigin(windowRef) {
  return typeof windowRef?.location?.origin === 'string' ? windowRef.location.origin : ''
}

function normalizeValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTraceOrigin(value) {
  const candidate = normalizeValue(value)
  try {
    const url = new URL(candidate)
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : ''
  } catch {
    return ''
  }
}

export function resolveNalaLabsOrigin(env = import.meta.env) {
  const configuredOrigin = typeof env?.VITE_NALA_LABS_URL === 'string' ? env.VITE_NALA_LABS_URL.trim() : ''
  const candidate = configuredOrigin || DEFAULT_NALA_LABS_ORIGIN

  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return DEFAULT_NALA_LABS_ORIGIN
    return url.origin
  } catch {
    return DEFAULT_NALA_LABS_ORIGIN
  }
}

function getSessionStorage(windowRef) {
  try {
    return windowRef?.sessionStorage || null
  } catch {
    return null
  }
}

export function buildNalaLabsLoginUrl({ env = import.meta.env, traceOrigin = getLocationOrigin(globalThis) } = {}) {
  const url = new URL('/login', resolveNalaLabsOrigin(env))
  const origin = normalizeTraceOrigin(traceOrigin)
  if (origin) url.searchParams.set('trace_origin', origin)
  return url.toString()
}

export function readNalaLabsAuthCode(windowRef = globalThis) {
  const search = typeof windowRef?.location?.search === 'string' ? windowRef.location.search : ''
  return normalizeValue(new URLSearchParams(search).get(NALA_LABS_AUTH_CODE_QUERY_PARAM))
}

export function clearNalaLabsAuthCode(windowRef = globalThis) {
  if (typeof windowRef?.history?.replaceState !== 'function' || typeof windowRef?.location?.href !== 'string') return false

  const url = new URL(windowRef.location.href)
  url.searchParams.delete(NALA_LABS_AUTH_CODE_QUERY_PARAM)
  const nextURL = `${url.pathname}${url.search}${url.hash}`
  windowRef.history.replaceState(windowRef.history.state, '', nextURL)
  return true
}

export function redirectToNalaLabs({ env = import.meta.env, windowRef = globalThis, traceOrigin = getLocationOrigin(windowRef) } = {}) {
  const assign = windowRef?.location?.assign
  if (typeof assign !== 'function') return false
  try {
    assign.call(windowRef.location, buildNalaLabsLoginUrl({ env, traceOrigin }))
    return true
  } catch {
    return false
  }
}

export function buildNalaLabsLogoutUrl({ env = import.meta.env } = {}) {
  const url = new URL('/login', resolveNalaLabsOrigin(env))
  url.searchParams.set('logout', '1')
  return url.toString()
}

export function signOutFromTrace({ env = import.meta.env, windowRef = globalThis } = {}) {
  const storage = getSessionStorage(windowRef)
  try {
    storage?.removeItem?.(NALA_LABS_ACCESS_TOKEN_STORAGE_KEY)
  } catch {
    // Continue clearing the in-memory credential when storage is unavailable.
  }
  clearAuthConfiguration()

  if (typeof windowRef?.location?.assign !== 'function') return false
  windowRef.location.assign(buildNalaLabsLogoutUrl({ env }))
  return true
}

export async function redeemNalaLabsAuthCode({
  windowRef = globalThis,
  storage = getSessionStorage(windowRef),
  fetchImpl = typeof windowRef?.fetch === 'function' ? windowRef.fetch.bind(windowRef) : globalThis.fetch,
} = {}) {
  const code = readNalaLabsAuthCode(windowRef)
  if (!code) return { attempted: false, authenticated: false }

  clearNalaLabsAuthCode(windowRef)
  if (typeof fetchImpl !== 'function') throw new AuthHandoffError('Nala Labs sign-in is unavailable')

  let response
  try {
    response = await fetchImpl(TRACE_HANDOFF_REDEEM_PATH, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
  } catch {
    throw new AuthHandoffError('Nala Labs sign-in could not be completed')
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new AuthHandoffError('Nala Labs sign-in could not be completed', response.status)

  const token = normalizeValue(payload?.token ?? payload?.access_token)
  if (!token || !storage || typeof storage.setItem !== 'function') {
    throw new AuthHandoffError('Nala Labs sign-in did not return a usable session')
  }

  try {
    storage.setItem(NALA_LABS_ACCESS_TOKEN_STORAGE_KEY, token)
  } catch {
    throw new AuthHandoffError('Nala Labs sign-in did not return a usable session')
  }
  if (!bootstrapAuthFromSessionStorage(storage)) {
    throw new AuthHandoffError('Nala Labs sign-in did not return a usable session')
  }

  return { attempted: true, authenticated: true }
}
