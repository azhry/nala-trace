const JSON_HEADERS = { Accept: 'application/json' }
const AUTHENTICATION_REQUIRED_MESSAGE = 'Authentication is required'
export const NALA_LABS_ACCESS_TOKEN_STORAGE_KEY = 'nala_labs_access_token'
const authConfiguration = {
  jwt: null,
  apiToken: null,
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

function normalizeCredentialValue(value, name) {
  if (value == null) return null
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string when provided`)
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function authMode() {
  if (authConfiguration.jwt) return 'jwt'
  if (authConfiguration.apiToken) return 'apiToken'
  return 'cookie'
}

function getSessionStorage() {
  try {
    return globalThis.sessionStorage
  } catch {
    return null
  }
}

function configuredAuthHeaders() {
  if (authConfiguration.jwt) {
    return { Authorization: `Bearer ${authConfiguration.jwt}` }
  }
  if (authConfiguration.apiToken) {
    return { 'X-Nala-Labs-API-Key': authConfiguration.apiToken }
  }
  return {}
}

function requestOptions(options = {}) {
  const nextOptions = {
    ...options,
    headers: { ...JSON_HEADERS, ...options.headers, ...configuredAuthHeaders() },
  }

  if (authMode() === 'cookie') {
    nextOptions.credentials = options.credentials ?? 'include'
  } else {
    delete nextOptions.credentials
  }

  return nextOptions
}

async function fetchJSON(path, options = {}) {
  const response = await fetch(path, requestOptions(options))

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(`Request failed with status ${response.status}`, response.status, body)
  }

  return body
}

export function configureAuth({ jwt, apiToken } = {}) {
  const nextJwt = normalizeCredentialValue(jwt, 'jwt')
  const nextApiToken = normalizeCredentialValue(apiToken, 'apiToken')

  if (nextJwt && nextApiToken) {
    throw new Error('Configure exactly one of jwt or apiToken')
  }

  authConfiguration.jwt = nextJwt
  authConfiguration.apiToken = nextApiToken
}

export function clearAuthConfiguration() {
  authConfiguration.jwt = null
  authConfiguration.apiToken = null
}

export function bootstrapAuthFromSessionStorage(storage = getSessionStorage()) {
  if (authConfiguration.jwt || authConfiguration.apiToken || !storage || typeof storage.getItem !== 'function') return false

  try {
    const token = storage.getItem(NALA_LABS_ACCESS_TOKEN_STORAGE_KEY)
    if (!normalizeCredentialValue(token, 'jwt')) return false
    configureAuth({ jwt: token })
    return true
  } catch {
    return false
  }
}

export function resolveSession() {
  if (authMode() === 'apiToken') {
    return Promise.resolve({ authenticated: true, authenticationMode: 'apiToken' })
  }

  if (authMode() === 'jwt') {
    return Promise.resolve({ authenticated: true, authenticationMode: 'jwt' })
  }

  return Promise.reject(new ApiError(AUTHENTICATION_REQUIRED_MESSAGE, 401))
}

export function getSessions() {
  return fetchJSON('/sessions?limit=100')
}

export function getTrace(sessionId) {
  return fetchJSON(`/sessions/${encodeURIComponent(sessionId)}`)
}
