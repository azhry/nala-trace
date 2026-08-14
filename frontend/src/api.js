const JSON_HEADERS = { Accept: 'application/json' }

async function fetchJSON(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...JSON_HEADERS, ...options.headers },
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return response.json()
}

export function getHealth() {
  return fetchJSON('/healthz')
}

export function getSessions() {
  return fetchJSON('/api/sessions')
}

export function getTrace(sessionId) {
  return fetchJSON(`/api/sessions/${encodeURIComponent(sessionId)}`)
}
