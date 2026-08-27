import { EMPTY_TOKEN_USAGE, normalizeTokenUsage } from './tokenUsage'

const EMPTY_LIST = []
const LIFECYCLE_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'])
const TOOL_INPUT_PREVIEW_LIMIT = 520
const SHELL_TOOL_PATTERN = /(?:bash|shell|powershell|pwsh|terminal|unified_exec|exec_command|(?:^|[_-])sh(?:$|[_-])|(?:^|[_-])cmd(?:$|[_-]))/i
const COMMAND_INPUT_KEYS = ['command', 'cmd', 'script', 'shell_command']

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

function rawRecord(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return {}

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseRecordedInput(value) {
  if (value == null) return null
  if (typeof value === 'object') return value

  const text = cleanString(value)
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function decodeQuotedValue(value) {
  if (!value) return ''
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }

  return value.slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([\\'])/g, '$1')
}

function extractCommand(value) {
  const parsed = parseRecordedInput(value)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const key of COMMAND_INPUT_KEYS) {
      const command = cleanString(parsed[key])
      if (command) return command
    }
  }

  if (typeof parsed === 'string') {
    const namedCommand = parsed.match(/(?:^|[,{\s])(?:command|cmd|script|shell_command)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/s)
    if (namedCommand) return cleanString(decodeQuotedValue(namedCommand[1]))
    return parsed
  }

  return ''
}

function compactInputSummary(value) {
  const parsed = parseRecordedInput(value)
  if (parsed == null) return ''
  if (typeof parsed === 'string') return parsed

  try {
    return JSON.stringify(parsed)
  } catch {
    return String(parsed)
  }
}

export function clipToolInputPreview(value, limit = TOOL_INPUT_PREVIEW_LIMIT) {
  const text = String(value || '')
  if (text.length <= limit) return text
  return `${text.slice(0, limit).trimEnd()}…`
}

export function getToolInputPreview(toolName, input) {
  const hasInput = input != null && (typeof input !== 'string' || Boolean(input.trim()))
  if (!hasInput) return { label: 'Input', text: 'Input not recorded', kind: 'missing' }

  const isShellTool = SHELL_TOOL_PATTERN.test(cleanString(toolName))
  const preview = isShellTool ? extractCommand(input) : compactInputSummary(input)
  return {
    label: isShellTool && preview ? 'Command' : 'Input',
    text: clipToolInputPreview(preview || compactInputSummary(input)),
    kind: isShellTool && preview ? 'command' : 'summary',
  }
}

function firstString(sources, keys) {
  for (const source of sources) {
    for (const key of keys) {
      const value = cleanString(source?.[key])
      if (value) return value
    }
  }
  return ''
}

function firstArray(source, keys) {
  for (const key of keys) {
    if (Array.isArray(source?.[key])) return source[key]
  }
  return null
}

function summaryCount(summary, keys, fallback = 0) {
  for (const key of keys) {
    const value = Number(summary?.[key])
    if (Number.isFinite(value)) return value
  }
  return fallback
}

function summaryServerNames(summary) {
  const value = summary?.mcp_servers ?? summary?.mcpServers
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(cleanString).filter(Boolean))]
}

function normalizeSkillInvocation(item = {}) {
  const record = rawRecord(item)
  return {
    name: firstString([record], ['name', 'skill_name', 'skillName']),
    eventId: firstString([record], ['event_id', 'eventId']),
    toolUseId: firstString([record], ['tool_use_id', 'toolUseId']) || null,
    toolName: firstString([record], ['tool_name', 'toolName']) || null,
    confidence: firstString([record], ['confidence']) || null,
    occurredAt: record.occurred_at ?? record.occurredAt ?? null,
    raw: record.raw ?? null,
  }
}

function normalizeFileOperation(item = {}) {
  const record = rawRecord(item)
  return {
    path: firstString([record], ['path', 'file_path', 'filePath']),
    operation: firstString([record], ['operation', 'action']).toLowerCase() || 'ambiguous',
    eventId: firstString([record], ['event_id', 'eventId']),
    toolUseId: firstString([record], ['tool_use_id', 'toolUseId']) || null,
    toolName: firstString([record], ['tool_name', 'toolName']) || null,
    confidence: firstString([record], ['confidence']) || null,
    occurredAt: record.occurred_at ?? record.occurredAt ?? null,
    raw: record.raw ?? null,
  }
}

export function getFileOperations(event = {}) {
  if (Array.isArray(event.fileRecords) && event.fileRecords.length) return event.fileRecords

  return (Array.isArray(event.files) ? event.files : []).map((path) => ({
    path,
    operation: cleanString(event.action).toLowerCase() || 'ambiguous',
  }))
}

export function isReadFileOperation(record = {}) {
  return cleanString(record.operation ?? record.action).toLowerCase() === 'read'
}

export function skillNameFromFilePath(file) {
  const path = cleanString(file).replaceAll('\\', '/').replace(/\/+/g, '/')
  const match = path.match(/(?:^|\/)skills\/(?:\.system\/)?([^/]+)(?:\/|$)/i)
  return match ? match[1] : ''
}

export function isSkillDocumentPath(file) {
  const path = cleanString(file).replaceAll('\\', '/').replace(/\/+/g, '/')
  return /(?:^|\/)skills\/(?:\.system\/)?[^/]+\/SKILL\.md$/i.test(path)
}

function normalizeProvenance(item, raw) {
  const sources = [item, raw]
  const eventName = firstString(sources, ['hook_event_name', 'hookEventName', 'kind'])
  const agentId = firstString(sources, ['agent_id', 'agentId'])
  const agentType = firstString(sources, ['agent_type', 'agentType'])
  const source = agentId || agentType ? 'agent' : eventName ? 'lifecycle' : 'root'

  return {
    source,
    eventName: eventName || null,
    agentId: agentId || null,
    agentType: agentType || null,
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

function normalizeConversationItem(item = {}, index) {
  const content = item.content
  const body = serializeJson(content)
  const role = normalizeRole(item.role)
  const raw = rawRecord(item.raw)
  const provenance = normalizeProvenance(item, raw)
  const eventId = cleanString(item.event_id ?? item.eventId)
  const isAgentEvidence = Boolean(provenance.agentId || provenance.agentType)
  const isRootUserPrompt = provenance.eventName === 'UserPromptSubmit' && role === 'user' && !isAgentEvidence
  const isLifecycleEvidence = LIFECYCLE_EVENTS.has(provenance.eventName) && !isRootUserPrompt
  const conversationVisible = (role === 'user' || role === 'assistant') && !isAgentEvidence && !isLifecycleEvidence
  const turnId = cleanString(item.turn_id ?? item.turnId)
  const occurredAt = item.occurred_at ?? item.occurredAt
  const hasContent = Boolean(body.trim())
  const hasTurnId = Boolean(turnId)
  const hasTimestamp = Boolean(occurredAt)

  return {
    id: `conversation-${index}`,
    eventId: eventId || null,
    type: conversationVisible ? role : 'context',
    role,
    roleLabel: roleLabel(role),
    body,
    contentIsCode: isCodeShaped(content, body),
    hasContent,
    turnId: turnId || null,
    turnLabel: turnId || 'Turn not recorded',
    turnBoundary: false,
    occurredAt,
    time: formatTraceTimestamp(occurredAt),
    partial: !hasContent || !hasTurnId || !hasTimestamp || role === 'unknown',
    conversationVisible,
    contextType: isAgentEvidence ? role === 'assistant' ? 'agent-reply' : 'agent-prompt' : 'system-event',
    raw: item.raw ?? null,
    provenance,
    lifecycleEvent: provenance.eventName,
    tokenUsage: normalizeTokenUsage(item.token_usage ?? item.tokenUsage),
  }
}

function markConversationBoundaries(events) {
  let previousTurnId = null
  return events.map((event, index) => {
    const turnBoundary = index === 0 || event.turnId !== previousTurnId
    previousTurnId = event.turnId
    return { ...event, turnBoundary }
  })
}

function normalizeToolCall(call = {}, index) {
  const startedAt = call.started_at ?? call.startedAt
  const completedAt = call.completed_at ?? call.completedAt
  const occurredAt = startedAt || completedAt
  const start = startedAt ? new Date(startedAt).getTime() : NaN
  const end = completedAt ? new Date(completedAt).getTime() : NaN
  const duration = Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? `${((end - start) / 1000).toFixed(2)}s`
    : 'duration not recorded'
  const status = cleanString(call.status) || 'recorded'
  const raw = rawRecord(call.raw)
  const provenance = normalizeProvenance(call, raw)
  const inputPreview = getToolInputPreview(call.tool_name ?? call.toolName, call.input)

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
    inputPreviewLabel: inputPreview.label,
    inputPreview: inputPreview.text,
    inputPreviewKind: inputPreview.kind,
    response: serializeJson(call.output),
    responseLabel: 'JSON',
    skills: EMPTY_LIST,
    files: EMPTY_LIST,
    skillRecords: EMPTY_LIST,
    fileRecords: EMPTY_LIST,
    raw: call.raw ?? null,
    occurredAt,
    turnId: cleanString(call.turn_id ?? call.turnId) || null,
    provenance,
    lifecycleEvent: provenance.eventName,
    tokenUsage: normalizeTokenUsage(call.token_usage ?? call.tokenUsage),
  }
}

function normalizeTimelineEvent(event = {}, index) {
  const raw = rawRecord(event.raw)
  const provenance = normalizeProvenance(event, raw)
  const label = provenance.eventName || 'Timeline event'
  const occurredAt = event.occurred_at ?? event.occurredAt
  const toolCallIndex = Number.isInteger(event.tool_call_index)
    ? event.tool_call_index
    : Number.isInteger(event.toolCallIndex)
      ? event.toolCallIndex
      : null
  return {
    id: cleanString(event.id) || `timeline-${index}`,
    type: 'system',
    label,
    body: cleanString(event.partial_reason ?? event.partialReason) || 'Recorded trace event',
    time: formatTraceTimestamp(occurredAt),
    occurredAt,
    turnId: cleanString(event.turn_id ?? event.turnId) || null,
    toolCallIndex,
    record: null,
    skills: EMPTY_LIST,
    files: EMPTY_LIST,
    skillRecords: EMPTY_LIST,
    fileRecords: EMPTY_LIST,
    raw: event.raw ?? null,
    provenance,
    lifecycleEvent: provenance.eventName,
    tokenUsage: normalizeTokenUsage(event.token_usage ?? event.tokenUsage),
  }
}

function eventTimestamp(value) {
  if (!value) return Number.POSITIVE_INFINITY
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY
}

function eventMatchKey(eventName, occurredAt, turnId) {
  return `${eventName || ''}|${eventTimestamp(occurredAt)}|${turnId || ''}`
}

function eventTimeKey(eventName, occurredAt) {
  return `${eventName || ''}|${eventTimestamp(occurredAt)}`
}

function withTimelinePosition(event, timeline, streamOrder) {
  return {
    ...event,
    streamOrder,
    timelineId: timeline.id,
    occurredAt: timeline.occurredAt,
    time: timeline.time,
    turnId: event.turnId || timeline.turnId,
    tokenUsage: event.tokenUsage || timeline.tokenUsage,
  }
}

function sortStreamEvents(events) {
  return [...events].sort((left, right) => eventTimestamp(left.occurredAt) - eventTimestamp(right.occurredAt) || (left.streamOrder ?? 0) - (right.streamOrder ?? 0))
}

function sortTimelineStreamEvents(events) {
  return [...events].sort((left, right) => (left.streamOrder ?? Number.POSITIVE_INFINITY) - (right.streamOrder ?? Number.POSITIVE_INFINITY))
}

function withSignalRecords(event, skillRecords = EMPTY_LIST, fileRecords = EMPTY_LIST) {
  return {
    ...event,
    skills: skillRecords.map((record) => record.name).filter(Boolean),
    files: fileRecords.map((record) => record.path).filter(Boolean),
    skillRecords,
    fileRecords,
  }
}

function projectApiSignals({ timelineEvents, toolEvents, skillInvocations, files }) {
  const timelineById = new Map(timelineEvents.map((event) => [event.id, event]))
  const signalsByTimelineId = new Map()
  const toolSignals = toolEvents.map(() => ({ skills: [], files: [] }))

  function addSignal(kind, record) {
    const timeline = timelineById.get(record.eventId)
    if (!timeline) return

    const signal = signalsByTimelineId.get(record.eventId) || { skills: [], files: [] }
    signal[kind].push(record)
    signalsByTimelineId.set(record.eventId, signal)

    if (Number.isInteger(timeline.toolCallIndex) && timeline.toolCallIndex >= 0 && toolSignals[timeline.toolCallIndex]) {
      toolSignals[timeline.toolCallIndex][kind].push(record)
    }
  }

  skillInvocations.forEach((record) => addSignal('skills', record))
  files.forEach((record) => addSignal('files', record))

  const projectedTimelineEvents = timelineEvents.map((event) => {
    const signal = signalsByTimelineId.get(event.id)
    return signal ? withSignalRecords(event, signal.skills, signal.files) : event
  })
  const projectedToolEvents = toolEvents.map((event, index) => {
    const signal = toolSignals[index]
    return signal.skills.length || signal.files.length
      ? withSignalRecords(event, signal.skills, signal.files)
      : event
  })

  return { timelineEvents: projectedTimelineEvents, toolEvents: projectedToolEvents }
}

function composeApiStream({ conversationEvents, contextEvents, toolEvents, timelineEvents }) {
  if (!timelineEvents.length) return sortStreamEvents([...conversationEvents, ...contextEvents, ...toolEvents])

  const messagesById = new Map()
  const messagesByKey = new Map()
  const messagesByTime = new Map()
  const claimedMessages = new Set()
  const addMessage = (message) => {
    if (message.eventId) {
      const byId = messagesById.get(message.eventId) || []
      byId.push(message)
      messagesById.set(message.eventId, byId)
    }
    const key = eventMatchKey(message.provenance.eventName, message.occurredAt, message.turnId)
    const byKey = messagesByKey.get(key) || []
    byKey.push(message)
    messagesByKey.set(key, byKey)
    const timeKey = eventTimeKey(message.provenance.eventName, message.occurredAt)
    const byTime = messagesByTime.get(timeKey) || []
    byTime.push(message)
    messagesByTime.set(timeKey, byTime)
  }
  conversationEvents.forEach(addMessage)
  contextEvents.forEach(addMessage)

  const consume = (collection, key) => {
    const values = collection.get(key)
    if (!values?.length) return null
    while (values.length) {
      const message = values.shift()
      if (!claimedMessages.has(message.id)) {
        claimedMessages.add(message.id)
        return message
      }
    }
    return null
  }
  const stream = []
  const emittedTools = new Set()
  const messageEvents = new Set(['UserPromptSubmit', 'Stop', 'SubagentStop'])

  timelineEvents.forEach((timeline, streamOrder) => {
    const eventName = timeline.provenance.eventName
    if (messageEvents.has(eventName)) {
      const message = consume(messagesById, timeline.id)
        || consume(messagesByKey, eventMatchKey(eventName, timeline.occurredAt, timeline.turnId))
        || consume(messagesByTime, eventTimeKey(eventName, timeline.occurredAt))
      if (message) {
        stream.push(withTimelinePosition(message, timeline, streamOrder))
        return
      }
    }

    if (eventName === 'PreToolUse' && Number.isInteger(timeline.toolCallIndex)) {
      const toolIndex = timeline.toolCallIndex
      const tool = toolEvents[toolIndex]
      if (tool && !emittedTools.has(toolIndex)) {
        emittedTools.add(toolIndex)
        stream.push(withTimelinePosition(tool, timeline, streamOrder))
        return
      }
    }

    if (eventName === 'PostToolUse'
      && Number.isInteger(timeline.toolCallIndex)
      && emittedTools.has(timeline.toolCallIndex)) {
      return
    }

    stream.push({ ...timeline, streamOrder })
  })

  const usedMessages = new Set()
  stream.forEach((event) => {
    if (event.type === 'user' || event.type === 'assistant' || event.type === 'context') usedMessages.add(event.id)
  })
  const leftovers = [...conversationEvents, ...contextEvents].filter((event) => !usedMessages.has(event.id))
  toolEvents.forEach((event, index) => {
    if (!emittedTools.has(index)) leftovers.push(event)
  })
  leftovers.forEach((event, index) => stream.push({ ...event, streamOrder: timelineEvents.length + index }))
  return sortTimelineStreamEvents(stream)
}

function apiTraceViewModel(trace) {
  const conversation = Array.isArray(trace.conversation) ? trace.conversation : EMPTY_LIST
  const normalizedConversation = conversation.map((item, index) => normalizeConversationItem(item, index))
  const conversationEvents = markConversationBoundaries(normalizedConversation.filter((event) => event.conversationVisible))
  const contextEvents = normalizedConversation.filter((event) => !event.conversationVisible)
  const toolEvents = Array.isArray(trace.tool_calls)
    ? trace.tool_calls.map(normalizeToolCall)
    : EMPTY_LIST
  const timelineEvents = Array.isArray(trace.timeline)
    ? trace.timeline.map(normalizeTimelineEvent)
    : EMPTY_LIST
  const summary = trace.summary && typeof trace.summary === 'object' ? trace.summary : {}
  const skillInvocationSource = firstArray(trace, ['skill_invocations', 'skillInvocations'])
  const fileOperationSource = firstArray(trace, ['files', 'fileOperations'])
  const skillInvocations = (skillInvocationSource || EMPTY_LIST).map(normalizeSkillInvocation)
  const files = (fileOperationSource || EMPTY_LIST).map(normalizeFileOperation)
  const skillInvocationCount = skillInvocationSource
    ? skillInvocations.length
    : summaryCount(summary, ['skill_invocation_count', 'skillInvocationCount'])
  const fileOperationCount = fileOperationSource
    ? files.length
    : summaryCount(summary, ['file_operation_count', 'fileOperationCount'])
  const fileReadCount = fileOperationSource
    ? files.filter((file) => file.operation === 'read').length
    : summaryCount(summary, ['file_read_count', 'fileReadCount'])
  const mcpCallCount = summaryCount(summary, ['mcp_call_count', 'mcpCallCount'])
  const mcpServers = summaryServerNames(summary)
  const projectedSignals = projectApiSignals({ timelineEvents, toolEvents, skillInvocations, files })
  const partial = conversationEvents.some((event) => event.partial)

  const orderedEvents = composeApiStream({
    conversationEvents,
    contextEvents,
    toolEvents: projectedSignals.toolEvents,
    timelineEvents: projectedSignals.timelineEvents,
  })

  return {
    source: 'api',
    events: orderedEvents,
    conversation: conversationEvents,
    contextEvents,
    partial,
    partialMessage: partial ? 'Some message content or turn metadata was not recorded.' : '',
    semanticRecords: summaryCount(summary, ['event_count', 'eventCount'], timelineEvents.length),
    messageCount: conversationEvents.length,
    toolCount: summaryCount(summary, ['tool_call_count', 'toolCallCount'], toolEvents.length),
    mcpCallCount,
    mcpServers,
    skillInvocations,
    files,
    skillInvocationCount,
    fileOperationCount,
    fileReadCount,
    skillCount: skillInvocationCount,
    fileCount: fileOperationCount,
    signalCounts: {
      skills: skillInvocationCount,
      files: fileOperationCount,
      fileReads: fileReadCount,
      mcpCalls: mcpCallCount,
      mcpServers: mcpServers.length,
    },
    tokenUsage: normalizeTokenUsage(summary.token_usage ?? summary.tokenUsage) || EMPTY_TOKEN_USAGE,
    startedAt: orderedEvents[0]?.time || 'Time not recorded',
    capturedAt: orderedEvents.at(-1)?.time || 'Time not recorded',
  }
}

function legacyTraceViewModel(trace) {
  const events = Array.isArray(trace.eventsList) ? trace.eventsList : EMPTY_LIST
  const conversation = events.filter((event) => event.type === 'user' || event.type === 'assistant')
  return {
    source: 'legacy',
    events,
    conversation,
    contextEvents: EMPTY_LIST,
    partial: false,
    partialMessage: '',
    semanticRecords: Number(trace.events || events.length).toLocaleString(),
    messageCount: Number(trace.messages || conversation.length),
    toolCount: Number(trace.toolCalls || events.filter((event) => event.type === 'tool').length),
    mcpCallCount: 0,
    mcpServers: EMPTY_LIST,
    tokenUsage: normalizeTokenUsage(trace.token_usage ?? trace.tokenUsage) || EMPTY_TOKEN_USAGE,
    startedAt: trace.startedAt || 'Time not recorded',
    capturedAt: trace.capturedAt || 'Time not recorded',
  }
}

export function normalizeTraceViewModel(trace = {}) {
  const isApiTrace = hasOwn(trace, 'schema_version') || hasOwn(trace, 'conversation') || hasOwn(trace, 'timeline')
  return isApiTrace ? apiTraceViewModel(trace) : legacyTraceViewModel(trace)
}
