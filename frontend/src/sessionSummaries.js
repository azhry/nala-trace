const EMPTY_DATE = Number.POSITIVE_INFINITY

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
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
  const id = cleanString(summary.session_id || summary.id)
  const firstEventAt = cleanString(summary.first_event_at || summary.firstEventAt)
  const lastEventAt = cleanString(summary.last_event_at || summary.lastEventAt)
  const evaluationStatus = statusValue(summary)
  const firstDate = new Date(firstEventAt)
  const lastDate = new Date(lastEventAt)

  return {
    id,
    title: id || 'Untitled session',
    firstEventAt,
    lastEventAt,
    firstEventTime: Number.isNaN(firstDate.getTime()) ? null : firstDate.getTime(),
    lastEventTime: Number.isNaN(lastDate.getTime()) ? null : lastDate.getTime(),
    eventCount: numberOrZero(summary.event_count ?? summary.eventCount),
    toolCallCount: numberOrZero(summary.tool_call_count ?? summary.toolCallCount),
    skillInvocationCount: numberOrZero(summary.skill_invocation_count ?? summary.skillInvocationCount),
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
    summary.id,
    summary.firstEventAt,
    summary.lastEventAt,
    formatSessionDate(summary.firstEventAt),
    formatSessionDate(summary.lastEventAt),
    `events ${summary.eventCount}`,
    `tools ${summary.toolCallCount}`,
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
