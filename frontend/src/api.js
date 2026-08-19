const JSON_HEADERS = { Accept: 'application/json' }

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function fetchJSON(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...JSON_HEADERS, ...options.headers },
  })

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(`Request failed with status ${response.status}`, response.status, body)
  }

  return body
}

export function resolveSession() {
  return fetchJSON('/api/auth/session', { credentials: 'include' }).then((payload) => {
    if (payload?.authenticated === false || (!payload?.authenticated && !payload?.user && !payload?.id && !payload?.user_id)) {
      throw new ApiError('Authentication is required', 401, payload)
    }
    return payload
  })
}

export function getSessions() {
  return fetchJSON('/sessions?limit=100', { credentials: 'include' })
}

export function getTrace(sessionId) {
  return fetchJSON(`/sessions/${encodeURIComponent(sessionId)}`, { credentials: 'include' })
}
