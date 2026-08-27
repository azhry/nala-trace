const EMPTY_DATE = Number.POSITIVE_INFINITY

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function countValue(summary, scalarKeys, collectionKeys = []) {
  let explicitCount = 0
  let hasExplicitCount = false
  for (const key of scalarKeys) {
    if (summary?.[key] !== undefined && summary?.[key] !== null) {
      hasExplicitCount = true
      explicitCount = Math.max(explicitCount, numberOrZero(summary[key]))
    }
  }
  let capturedCount = 0
  for (const key of collectionKeys) {
    const value = summary?.[key]
    if (Array.isArray(value)) capturedCount = Math.max(capturedCount, value.length)
    else if (value !== undefined && value !== null) capturedCount = Math.max(capturedCount, numberOrZero(value))
  }
  return Math.max(hasExplicitCount ? explicitCount : 0, capturedCount)
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function serverNamesValue(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(cleanString).filter(Boolean))]
}

function statusValue(summary) {
  const value = cleanString(summary.evaluation_status || summary.evaluationStatus || summary.status).toLowerCase()
  if (['pass', 'passed', 'success', 'successful'].includes(value)) return 'passed'
  if (['attention', 'needs_review', 'needs review', 'fail', 'failed', 'error'].includes(value)) return 'attention'
  return value
}

export function formatSessionDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function normalizeSessionSummary(summary = {}) {
  const id = cleanString(summary.session_id) || cleanString(summary.id)
  const title = cleanString(summary.title) || id || 'Untitled session'
  const firstEventAt = cleanString(summary.first_event_at || summary.firstEventAt)
  const lastEventAt = cleanString(summary.last_event_at || summary.lastEventAt)
  const evaluationStatus = statusValue(summary)
  const firstDate = new Date(firstEventAt)
  const lastDate = new Date(lastEventAt)

  return {
    id,
    title,
    firstEventAt,
    lastEventAt,
    firstEventTime: Number.isNaN(firstDate.getTime()) ? null : firstDate.getTime(),
    lastEventTime: Number.isNaN(lastDate.getTime()) ? null : lastDate.getTime(),
    eventCount: numberOrZero(summary.event_count ?? summary.eventCount),
    toolCallCount: numberOrZero(summary.tool_call_count ?? summary.toolCallCount),
    mcpCallCount: numberOrZero(summary.mcp_call_count ?? summary.mcpCallCount),
    mcpServers: serverNamesValue(summary.mcp_servers ?? summary.mcpServers),
    skillInvocationCount: countValue(
      summary,
      ['skill_invocation_count', 'skillInvocationCount', 'skill_count', 'skillCount'],
      ['skill_invocations', 'skillInvocations', 'skills'],
    ),
    fileOperationCount: numberOrZero(summary.file_operation_count ?? summary.fileOperationCount),
    evaluationStatus,
    status: evaluationStatus || 'captured',
  }
}

export function normalizeSessionSummaries(payload) {
  const summaries = Array.isArray(payload?.sessions) ? payload.sessions : []
  return summaries.map(normalizeSessionSummary).filter((summary) => summary.id)
}

function compareDescending(left, right) {
  return right - left
}

function compareIds(left, right) {
  return left.id.localeCompare(right.id)
}

export function sortSessionSummaries(summaries, sortBy = 'recent') {
  return summaries
    .map((summary, index) => ({ summary, index }))
    .sort((left, right) => {
      const a = left.summary
      const b = right.summary
      let comparison = 0

      if (sortBy === 'tools') comparison = compareDescending(a.toolCallCount, b.toolCallCount)
      else if (sortBy === 'events') comparison = compareDescending(a.eventCount, b.eventCount)
      else {
        const aTime = a.lastEventTime ?? EMPTY_DATE
        const bTime = b.lastEventTime ?? EMPTY_DATE
        comparison = aTime === bTime ? 0 : aTime === EMPTY_DATE ? 1 : bTime === EMPTY_DATE ? -1 : compareDescending(aTime, bTime)
      }

      return comparison || compareIds(a, b) || left.index - right.index
    })
    .map(({ summary }) => summary)
}

function searchableMetadata(summary) {
  return [
    summary.title,
    summary.id,
    summary.firstEventAt,
    summary.lastEventAt,
    formatSessionDate(summary.firstEventAt),
    formatSessionDate(summary.lastEventAt),
    `events ${summary.eventCount}`,
    `tools ${summary.toolCallCount}`,
    `mcp ${summary.mcpCallCount}`,
    `mcp calls ${summary.mcpCallCount}`,
    `mcp servers ${summary.mcpServers.join(' ')}`,
    `skills ${summary.skillInvocationCount}`,
    `files ${summary.fileOperationCount}`,
    `status ${summary.evaluationStatus}`,
  ].join(' ').toLowerCase()
}

export function filterSessionSummaries(summaries, query = '', status = 'all') {
  const normalizedQuery = query.trim().toLowerCase()
  return summaries.filter((summary) => {
    const matchesStatus = status === 'all' || summary.status === status
    return matchesStatus && (!normalizedQuery || searchableMetadata(summary).includes(normalizedQuery))
  })
}
