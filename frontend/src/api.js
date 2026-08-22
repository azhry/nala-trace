const JSON_HEADERS = { Accept: 'application/json' }
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

export function resolveSession() {
  if (authMode() === 'apiToken') {
    return Promise.resolve({ authenticated: true, authenticationMode: 'apiToken' })
  }

  return fetchJSON('/api/auth/session').then((payload) => {
    if (payload?.authenticated === false || (!payload?.authenticated && !payload?.user && !payload?.id && !payload?.user_id)) {
      throw new ApiError('Authentication is required', 401, payload)
    }
    return payload
  })
}

export function getSessions() {
  return fetchJSON('/sessions?limit=100')
}

export function getTrace(sessionId) {
  return fetchJSON(`/sessions/${encodeURIComponent(sessionId)}`)
}
