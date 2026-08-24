import { bootstrapAuthFromSessionStorage, NALA_LABS_ACCESS_TOKEN_STORAGE_KEY } from './api'

export const DEFAULT_NALA_LABS_ORIGIN = 'http://localhost:5173'
export const NALA_LABS_AUTH_MESSAGE_TYPE = 'nala-labs-authenticated'

function getLocationOrigin(windowRef) {
  return typeof windowRef?.location?.origin === 'string' ? windowRef.location.origin : ''
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

export function buildNalaLabsLoginUrl({ env = import.meta.env, traceOrigin = getLocationOrigin(globalThis) } = {}) {
  const url = new URL('/login', resolveNalaLabsOrigin(env))
  if (typeof traceOrigin === 'string' && traceOrigin.trim()) url.searchParams.set('trace_origin', traceOrigin.trim())
  return url.toString()
}

function normalizeToken(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function getSessionStorage(windowRef) {
  try {
    return windowRef?.sessionStorage || null
  } catch {
    return null
  }
}

export function createNalaLabsAuthHandoff({
  env = import.meta.env,
  windowRef = globalThis,
  storage = getSessionStorage(windowRef),
  traceOrigin = getLocationOrigin(windowRef),
  onAuthenticated = () => {},
  onPopupBlocked = () => {},
  onStorageError = () => {},
} = {}) {
  const expectedOrigin = resolveNalaLabsOrigin(env)
  let popup = null
  let listening = false

  function stopListening() {
    if (!listening || typeof windowRef.removeEventListener !== 'function') return
    windowRef.removeEventListener('message', handleMessage)
    listening = false
  }

  function handleMessage(event) {
    if (event?.origin !== expectedOrigin || event?.source !== popup) return false
    if (!event.data || event.data.type !== NALA_LABS_AUTH_MESSAGE_TYPE) return false

    const token = normalizeToken(event.data.token)
    if (!token || !storage || typeof storage.setItem !== 'function') {
      onStorageError()
      return false
    }

    try {
      storage.setItem(NALA_LABS_ACCESS_TOKEN_STORAGE_KEY, token)
    } catch {
      onStorageError()
      return false
    }

    stopListening()
    onAuthenticated()
    return true
  }

  function open() {
    stopListening()
    popup = null

    let nextPopup
    try {
      nextPopup = typeof windowRef.open === 'function'
        ? windowRef.open(buildNalaLabsLoginUrl({ env, traceOrigin }), 'nala-labs-login', 'popup,width=480,height=720')
        : null
    } catch {
      nextPopup = null
    }

    if (!nextPopup) {
      onPopupBlocked()
      return null
    }

    popup = nextPopup
    if (typeof windowRef.addEventListener === 'function') {
      windowRef.addEventListener('message', handleMessage)
      listening = true
    }
    return popup
  }

  function dispose() {
    stopListening()
    popup = null
  }

  return {
    buildLoginUrl: () => buildNalaLabsLoginUrl({ env, traceOrigin }),
    expectedOrigin,
    handleMessage,
    open,
    dispose,
    isAuthenticated: () => bootstrapAuthFromSessionStorage(storage),
  }
}
