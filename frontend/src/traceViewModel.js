const EMPTY_LIST = []

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key)
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function serializeJson(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isCodeShaped(value, text) {
  return typeof value !== 'string'
    || text.includes('\n')
    || /```|[{}[\];<>]|\b(const|function|return|import|export)\b/.test(text)
}

export function formatTraceTimestamp(value) {
  if (!value) return 'Time not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Time not recorded'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function normalizeRole(value) {
  const role = cleanString(value).toLowerCase()
  if (role === 'user' || role === 'assistant') return role
  return role || 'unknown'
}

function roleLabel(role) {
  if (role === 'user') return 'User'
  if (role === 'assistant') return 'Codex'
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Unknown role'
}

function normalizeConversationItem(item = {}, index, previousTurnId) {
  const content = item.content
  const body = serializeJson(content)
  const role = normalizeRole(item.role)
  const turnId = cleanString(item.turn_id ?? item.turnId)
  const occurredAt = item.occurred_at ?? item.occurredAt
  const hasContent = Boolean(body.trim())
  const hasTurnId = Boolean(turnId)
  const hasTimestamp = Boolean(occurredAt)

  return {
    id: `conversation-${index}`,
    type: role === 'user' || role === 'assistant' ? role : 'assistant',
    role,
    roleLabel: roleLabel(role),
    body,
    contentIsCode: isCodeShaped(content, body),
    hasContent,
    turnId: turnId || null,
    turnLabel: turnId || 'Turn not recorded',
    turnBoundary: index === 0 || turnId !== previousTurnId,
    occurredAt,
    time: formatTraceTimestamp(occurredAt),
    partial: !hasContent || !hasTurnId || !hasTimestamp || role === 'unknown',
  }
}

function normalizeToolCall(call = {}, index) {
  const startedAt = call.started_at ?? call.startedAt
  const completedAt = call.completed_at ?? call.completedAt
  const start = startedAt ? new Date(startedAt).getTime() : NaN
  const end = completedAt ? new Date(completedAt).getTime() : NaN
  const duration = Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? `${((end - start) / 1000).toFixed(2)}s`
    : 'duration not recorded'
  const status = cleanString(call.status) || 'recorded'

  return {
    id: `tool-${index}`,
    type: 'tool',
    index: String(index + 1).padStart(3, '0'),
    tool: cleanString(call.tool_name ?? call.toolName) || 'Unnamed tool',
    time: formatTraceTimestamp(startedAt || completedAt),
    duration,
    intent: 'Captured tool call',
    action: 'call',
    status,
    record: null,
    input: serializeJson(call.input),
    response: serializeJson(call.output),
    responseLabel: 'JSON',
    skills: EMPTY_LIST,
    files: EMPTY_LIST,
  }
}

function normalizeTimelineEvent(event = {}, index) {
  const label = cleanString(event.hook_event_name ?? event.hookEventName ?? event.kind) || 'Timeline event'
  return {
    id: cleanString(event.id) || `timeline-${index}`,
    type: 'system',
    label,
    body: cleanString(event.partial_reason ?? event.partialReason) || 'Recorded trace event',
    time: formatTraceTimestamp(event.occurred_at ?? event.occurredAt),
    record: null,
  }
}

function apiTraceViewModel(trace) {
  const conversation = Array.isArray(trace.conversation) ? trace.conversation : EMPTY_LIST
  let previousTurnId = null
  const conversationEvents = conversation.map((item, index) => {
    const event = normalizeConversationItem(item, index, previousTurnId)
    previousTurnId = event.turnId
    return event
  })
  const toolEvents = Array.isArray(trace.tool_calls)
    ? trace.tool_calls.map(normalizeToolCall)
    : EMPTY_LIST
  const timelineEvents = Array.isArray(trace.timeline)
    ? trace.timeline.map(normalizeTimelineEvent)
    : EMPTY_LIST
  const summary = trace.summary && typeof trace.summary === 'object' ? trace.summary : {}
  const partial = conversationEvents.some((event) => event.partial)

  return {
    source: 'api',
    events: [...conversationEvents, ...toolEvents, ...timelineEvents],
    conversation: conversationEvents,
    partial,
    partialMessage: partial ? 'Some message content or turn metadata was not recorded.' : '',
    semanticRecords: Number.isFinite(Number(summary.event_count)) ? Number(summary.event_count) : timelineEvents.length,
    messageCount: Number.isFinite(Number(summary.message_count)) ? Number(summary.message_count) : conversationEvents.length,
    toolCount: Number.isFinite(Number(summary.tool_call_count)) ? Number(summary.tool_call_count) : toolEvents.length,
    startedAt: conversationEvents[0]?.time || timelineEvents[0]?.time || 'Time not recorded',
    capturedAt: conversationEvents.at(-1)?.time || timelineEvents.at(-1)?.time || 'Time not recorded',
  }
}

function legacyTraceViewModel(trace) {
  const events = Array.isArray(trace.eventsList) ? trace.eventsList : EMPTY_LIST
  const conversation = events.filter((event) => event.type === 'user' || event.type === 'assistant')
  return {
    source: 'legacy',
    events,
    conversation,
    partial: false,
    partialMessage: '',
    semanticRecords: Number(trace.events || events.length).toLocaleString(),
    messageCount: Number(trace.messages || conversation.length),
    toolCount: Number(trace.toolCalls || events.filter((event) => event.type === 'tool').length),
    startedAt: trace.startedAt || 'Time not recorded',
    capturedAt: trace.capturedAt || 'Time not recorded',
  }
}

export function normalizeTraceViewModel(trace = {}) {
  const isApiTrace = hasOwn(trace, 'schema_version') || hasOwn(trace, 'conversation') || hasOwn(trace, 'timeline')
  return isApiTrace ? apiTraceViewModel(trace) : legacyTraceViewModel(trace)
}
