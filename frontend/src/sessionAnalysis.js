import { getToolInputPreview } from './traceViewModel'

const EMPTY_LIST = []
const TURN_PREVIEW_LIMIT = 240

const ANNOTATION_VERDICTS = new Set(['yes', 'no', 'unclear'])
const PERFORMANCE_VERDICTS = new Set(['improved', 'neutral', 'worsened', 'unclear'])
const EVALUATION_VERDICTS = new Set(['pass', 'fail', 'unknown'])
const ALIGNMENT_STATUSES = new Set(['aligned', 'not_aligned', 'not_recorded'])
const SIGNAL_NAME_LABELS = {
  unverified_authenticated_browser_flow: 'Authenticated browser flow not verified',
  unmatched_tool_hook_pairs: 'Unmatched tool hook pairs',
  delivery_branch_collision_recovered: 'Delivery branch collision recovered',
  environment_retry_without_regression: 'Environment retry completed without regression',
  live_api_contract_verified: 'Live API contract verified',
}
const SIGNAL_SEVERITY_MEANINGS = {
  warning: 'Review concern',
  info: 'Context, not a failure',
  critical: 'Requires attention',
  unknown: 'Meaning not recorded',
}
const SIGNAL_FOLLOW_UPS = {
  unmatched_tool_hook_pairs: 'Restore or verify completion-hook pairing for the listed tool calls before treating their necessity as known.',
  unverified_authenticated_browser_flow: 'Run the authenticated desktop and mobile browser flow and record the result.',
  delivery_branch_collision_recovered: 'Verify the final branch base, head, and PR after collision recovery.',
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function safeArray(value) {
  return Array.isArray(value) ? value : EMPTY_LIST
}

function validEnum(value, allowed) {
  const normalized = cleanString(value).toLowerCase()
  return allowed.has(normalized) ? normalized : null
}

function contentText(value) {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join(' ').trim()
  if (!isObject(value)) return ''

  for (const key of ['text', 'message', 'content', 'body', 'response', 'prompt']) {
    const text = contentText(value[key])
    if (text) return text
  }

  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function clipTurnPreview(value) {
  const text = contentText(value).replace(/\s+/g, ' ').trim()
  return text.length <= TURN_PREVIEW_LIMIT ? text : `${text.slice(0, TURN_PREVIEW_LIMIT).trimEnd()}…`
}

function humanizeSignalName(value) {
  const normalized = cleanString(value)
  if (!normalized) return 'Unnamed signal'
  if (SIGNAL_NAME_LABELS[normalized]) return SIGNAL_NAME_LABELS[normalized]
  if (!normalized.includes('_')) return normalized
  return normalized.split('_').map((word) => word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : '').join(' ')
}

function referenceCandidates(value) {
  const reference = cleanString(value)
  const match = reference.match(/^ObjectI[Dd]\("(.+)"\)$/)
  return match ? [reference, match[1]] : [reference]
}

function traceEvidenceLabel(trace, reference) {
  const candidates = referenceCandidates(reference)
  const conversationItem = safeArray(trace?.conversation).find((item) => candidates.includes(cleanString(item?.event_id ?? item?.eventId)))
  if (conversationItem) {
    const role = cleanString(conversationItem.role).toLowerCase()
    const roleLabel = role === 'assistant' ? 'Codex response' : role === 'user' ? 'User prompt' : 'Captured message'
    const preview = clipTurnPreview(conversationItem.content)
    return preview ? `${roleLabel}: ${preview}` : roleLabel
  }

  const timelineEvent = safeArray(trace?.timeline).find((event) => candidates.includes(cleanString(event?.id)))
  if (!timelineEvent) return null

  const toolCallIndex = timelineEvent.tool_call_index ?? timelineEvent.toolCallIndex
  const toolCall = Number.isInteger(toolCallIndex) ? safeArray(trace?.tool_calls)[toolCallIndex] : null
  if (toolCall) {
    const toolName = cleanString(toolCall.tool_name ?? toolCall.toolName) || 'Tool call'
    const input = toolCall.input ?? toolCall.tool_input
    const inputPreview = input == null ? null : getToolInputPreview(toolName, input)
    return inputPreview?.kind === 'missing' || !inputPreview?.text
      ? toolName
      : `${toolName}: ${inputPreview.text}`
  }

  return `${cleanString(timelineEvent.hook_event_name ?? timelineEvent.hookEventName) || 'Captured trace'} event`
}

function balancedJsonEnd(text, start) {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '{' || character === '[') {
      depth += 1
    } else if (character === '}' || character === ']') {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

function parseSignalExamples(detail) {
  const match = detail.match(/(?:example event ids?|example occurrences?|examples?)\s*:\s*(.*)$/i)
  if (!match) return []

  const source = match[1].trim().replace(/[.!?]+$/, '')
  const examples = []
  let cursor = 0
  while (cursor < source.length) {
    const objectStart = source.indexOf('{', cursor)
    if (objectStart === -1) break
    const labelEnd = source.lastIndexOf(':', objectStart)
    if (labelEnd < cursor) break
    const label = source.slice(cursor, labelEnd).replace(/^[\s,;]+|[\s,;]+$/g, '')
    const objectEnd = balancedJsonEnd(source, objectStart)
    if (objectEnd === -1) break

    const rawInput = source.slice(objectStart, objectEnd + 1)
    let input = null
    try {
      input = JSON.parse(rawInput)
    } catch {
      // Keep the raw evaluator detail when an example is not valid JSON.
    }
    examples.push({ label: label || 'Recorded occurrence', input, rawInput })
    cursor = objectEnd + 1
  }

  return examples
}

function timelineEventForToolCall(trace, toolCall) {
  const index = safeArray(trace?.tool_calls).indexOf(toolCall)
  if (index === -1) return null
  return safeArray(trace?.timeline).find((event) => (event?.tool_call_index ?? event?.toolCallIndex) === index) || null
}

function occurrenceFromToolCall(trace, toolCall, fallback = {}) {
  const timelineEvent = timelineEventForToolCall(trace, toolCall)
  const toolName = cleanString(toolCall?.tool_name ?? toolCall?.toolName) || cleanString(fallback.label) || 'Tool call'
  const toolUseId = cleanString(toolCall?.tool_use_id ?? toolCall?.toolUseId) || null
  const eventId = cleanString(timelineEvent?.id ?? toolCall?.event_id ?? toolCall?.eventId) || null
  const input = toolCall?.input ?? toolCall?.tool_input ?? fallback.input
  const inputPreview = input == null ? null : getToolInputPreview(toolName, input)
  const location = [
    eventId && `event id: ${eventId}`,
    toolUseId && `tool use: ${toolUseId}`,
    timelineEvent && cleanString(timelineEvent.hook_event_name ?? timelineEvent.hookEventName),
  ].filter(Boolean).join(' · ') || 'Location not recorded'

  return {
    label: toolName,
    toolName,
    toolUseId,
    eventId,
    location,
    inputLabel: inputPreview?.kind === 'missing' ? null : inputPreview?.label || null,
    input: inputPreview?.kind === 'missing' ? null : inputPreview?.text || fallback.rawInput || null,
    rationale: fallback.rationale || null,
  }
}

function traceToolForExample(trace, example) {
  const toolCalls = safeArray(trace?.tool_calls).filter((call) => cleanString(call?.tool_name ?? call?.toolName) === cleanString(example.label))
  if (!toolCalls.length) return null
  if (example.input == null) return toolCalls[0]

  const serializedExample = JSON.stringify(example.input)
  return toolCalls.find((call) => JSON.stringify(call?.input ?? call?.tool_input) === serializedExample) || toolCalls[0]
}

function annotationSignalOccurrences(signalName, annotation, trace) {
  if (signalName !== 'unmatched_tool_hook_pairs') return []

  const tools = safeArray(annotation?.tools).map((record) => normalizeTool(record, trace))
  const unclear = tools.filter((record) => record.necessary === 'unclear')
  const hookRelated = unclear.filter((record) => /unmatched|completion hook|hook pair/i.test(record.rationale))
  const records = hookRelated.length ? hookRelated : unclear
  return records.map((record) => occurrenceFromToolCall(trace, {
    tool_name: record.toolName,
    tool_use_id: record.toolUseId,
    input: record.inputPreview,
    event_id: record.eventId,
  }, {
    label: record.toolName,
    rationale: record.rationale,
  }))
}

function signalOccurrences(signalName, detail, trace, annotation) {
  const annotatedOccurrences = annotationSignalOccurrences(signalName, annotation, trace)
  if (annotatedOccurrences.length) return annotatedOccurrences

  const examples = parseSignalExamples(detail)
  if (examples.length) {
    return examples.map((example) => {
      const toolCall = traceToolForExample(trace, example)
      return toolCall
        ? occurrenceFromToolCall(trace, toolCall, example)
        : occurrenceFromToolCall(trace, { tool_name: example.label, input: example.input }, example)
    })
  }

  return Array.from(detail.matchAll(/ObjectI[Dd]\("([^"]+)"\)/g)).map((match) => {
    const reference = `ObjectID("${match[1]}")`
    return {
      label: traceEvidenceLabel(trace, reference) || reference,
      toolName: null,
      toolUseId: null,
      eventId: match[1],
      location: reference,
      inputLabel: null,
      input: null,
      rationale: null,
    }
  })
}

function readableSignalDetail(detail, trace) {
  return detail.replace(/ObjectI[Dd]\("([^"]+)"\)/g, (reference) => {
    const label = traceEvidenceLabel(trace, reference)
    return label ? label.replace(/[.!?]+$/, '') : reference
  })
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function countDistinctTurnEvidence(trace) {
  if (!Array.isArray(trace?.conversation)) return null

  const conversation = trace.conversation.filter((item) => {
    const role = cleanString(item?.role).toLowerCase()
    return role === 'user' || role === 'assistant'
  })
  const turnIds = new Set(conversation.map((item) => cleanString(item?.turn_id ?? item?.turnId)).filter(Boolean))
  return turnIds.size || conversation.length
}

function capturedCount(trace, collectionKey, summaryKeys, fallback) {
  if (Array.isArray(trace?.[collectionKey])) return trace[collectionKey].length

  for (const key of summaryKeys) {
    const count = numberOrNull(trace?.summary?.[key])
    if (count !== null) return count
  }

  return fallback
}

function capturedEvidenceCounts(trace = {}) {
  return {
    turns: countDistinctTurnEvidence(trace) ?? capturedCount(trace, 'conversation', ['message_count', 'messageCount'], null),
    tools: capturedCount(trace, 'tool_calls', ['tool_call_count', 'toolCallCount'], null),
    skills: capturedCount(trace, 'skill_invocations', ['skill_invocation_count', 'skillInvocationCount'], null),
  }
}

function linkedConversationItem(trace, record) {
  const conversation = safeArray(trace?.conversation)
  const eventId = cleanString(record.event_id ?? record.eventId)
  if (eventId) {
    const byEventId = conversation.find((item) => cleanString(item?.event_id ?? item?.eventId) === eventId)
    if (byEventId) return byEventId
  }

  let turnId = cleanString(record.turn_id ?? record.turnId)
  if (!turnId && eventId) {
    const timelineEvent = safeArray(trace?.timeline).find((event) => cleanString(event?.id) === eventId)
    turnId = cleanString(timelineEvent?.turn_id ?? timelineEvent?.turnId)
  }
  if (!turnId) return null

  const matching = conversation.filter((item) => cleanString(item?.turn_id ?? item?.turnId) === turnId)
  return matching.find((item) => cleanString(item?.role).toLowerCase() === 'assistant' && contentText(item?.content))
    || matching.find((item) => contentText(item?.content))
    || matching[0]
    || null
}

function normalizeTurn(record = {}, trace = {}) {
  const conversationItem = linkedConversationItem(trace, record)
  const turnId = cleanString(record.turn_id ?? record.turnId) || cleanString(conversationItem?.turn_id ?? conversationItem?.turnId) || null
  return {
    eventId: cleanString(record.event_id ?? record.eventId) || 'Event ID not recorded',
    turnId,
    turnRole: cleanString(conversationItem?.role).toLowerCase() || null,
    turnPreview: clipTurnPreview(conversationItem?.content) || null,
    followsInstructions: validEnum(record.follows_instructions ?? record.followsInstructions, ANNOTATION_VERDICTS),
    performance: validEnum(record.performance, PERFORMANCE_VERDICTS),
    rationale: cleanString(record.rationale) || 'Rationale not recorded',
  }
}

function linkedToolCall(trace, record) {
  const toolCalls = safeArray(trace?.tool_calls)
  const toolUseId = cleanString(record.tool_use_id ?? record.toolUseId)
  if (toolUseId) {
    const byToolUseId = toolCalls.find((call) => cleanString(call?.tool_use_id ?? call?.toolUseId) === toolUseId)
    if (byToolUseId) return byToolUseId
  }

  const eventId = cleanString(record.event_id ?? record.eventId)
  if (!eventId) return null
  const timeline = safeArray(trace?.timeline)
  const timelineEvent = timeline.find((event) => cleanString(event?.id) === eventId)
  const toolCallIndex = timelineEvent?.tool_call_index ?? timelineEvent?.toolCallIndex
  if (Number.isInteger(toolCallIndex) && toolCalls[toolCallIndex]) return toolCalls[toolCallIndex]

  return toolCalls.find((call) => cleanString(call?.event_id ?? call?.eventId) === eventId) || null
}

function linkedSkillInvocation(trace, record) {
  const invocations = safeArray(trace?.skill_invocations)
  const eventId = cleanString(record.event_id ?? record.eventId)
  if (eventId) {
    const byEventId = invocations.find((invocation) => cleanString(invocation?.event_id ?? invocation?.eventId) === eventId)
    if (byEventId) return byEventId
  }

  const skillName = cleanString(record.skill_name ?? record.skillName)
  return invocations.find((invocation) => cleanString(invocation?.name ?? invocation?.skill_name ?? invocation?.skillName) === skillName) || null
}

function normalizeTool(record = {}, trace = {}) {
  const toolCall = linkedToolCall(trace, record)
  const toolName = cleanString(record.tool_name ?? record.toolName) || cleanString(toolCall?.tool_name ?? toolCall?.toolName) || null
  const toolUseId = cleanString(record.tool_use_id ?? record.toolUseId) || cleanString(toolCall?.tool_use_id ?? toolCall?.toolUseId) || null
  const input = record.input ?? record.tool_input ?? toolCall?.input
  const inputPreview = input == null ? null : getToolInputPreview(toolName || '', input)
  const completionStatus = cleanString(record.completion_status ?? record.completionStatus ?? toolCall?.status ?? toolCall?.tool_status).toLowerCase() || null
  const completionDetail = completionStatus === 'unmatched'
    ? 'No matching completion hook was captured; the invocation is present but its completion evidence is incomplete.'
    : completionStatus === 'completed'
      ? 'Matching completion hook was captured.'
      : completionStatus
        ? `Captured completion status: ${completionStatus}.`
        : 'Completion status not recorded.'
  return {
    eventId: cleanString(record.event_id ?? record.eventId) || 'Event ID not recorded',
    toolUseId,
    toolName,
    inputPreview: inputPreview?.kind === 'missing' ? null : inputPreview?.text || null,
    inputPreviewLabel: inputPreview?.kind === 'missing' ? null : inputPreview?.label || null,
    completionStatus,
    completionDetail,
    necessary: validEnum(record.necessary, ANNOTATION_VERDICTS),
    rationale: cleanString(record.rationale) || 'Rationale not recorded',
  }
}

function normalizeSkill(record = {}, trace = {}) {
  const invocation = linkedSkillInvocation(trace, record)
  const eventId = cleanString(record.event_id ?? record.eventId) || cleanString(invocation?.event_id ?? invocation?.eventId) || 'Event ID not recorded'
  const skillName = cleanString(record.skill_name ?? record.skillName) || cleanString(invocation?.name ?? invocation?.skill_name ?? invocation?.skillName) || 'Skill name not recorded'
  const toolName = cleanString(invocation?.tool_name ?? invocation?.toolName) || null
  const toolUseId = cleanString(invocation?.tool_use_id ?? invocation?.toolUseId) || null
  const confidence = cleanString(invocation?.confidence) || null
  const invocationDetail = [
    `skill: ${skillName}`,
    toolName && `tool: ${toolName}`,
    toolUseId && `tool use: ${toolUseId}`,
    eventId !== 'Event ID not recorded' && `event id: ${eventId}`,
    confidence && `confidence: ${confidence}`,
  ].filter(Boolean).join(' · ') || 'Captured invocation details not recorded'

  return {
    eventId,
    skillName,
    toolName,
    toolUseId,
    confidence,
    invocationDetail,
    necessary: validEnum(record.necessary, ANNOTATION_VERDICTS),
    rationale: cleanString(record.rationale) || 'Rationale not recorded',
  }
}

function countVerdicts(records, key, values) {
  return values.map((value) => ({
    value,
    count: records.filter((record) => record[key] === value).length,
  }))
}

function coverageCopy(annotatedCount, capturedCountValue) {
  const annotated = annotatedCount.toLocaleString()
  if (capturedCountValue === null) return { value: `${annotated} labeled`, detail: 'Total not recorded' }
  if (capturedCountValue === 0) return { value: `${annotated} labeled / 0 total`, detail: 'No evidence in this trace' }
  const percentage = Math.round((annotatedCount / capturedCountValue) * 100)
  return {
    value: `${annotated} labeled / ${capturedCountValue.toLocaleString()} total`,
    detail: `${percentage}% labeled`,
  }
}

function normalizeCategory(key, label, records, capturedCountValue, fields) {
  const coverage = coverageCopy(records.length, capturedCountValue)
  return {
    key,
    label,
    records,
    annotatedCount: records.length,
    capturedCount: capturedCountValue,
    coverageValue: coverage.value,
    coverageDetail: coverage.detail,
    breakdowns: fields.map(({ label: fieldLabel, key: fieldKey, values }) => ({
      label: fieldLabel,
      key: fieldKey,
      values: countVerdicts(records, fieldKey, values),
    })),
  }
}

function normalizeAnnotation(annotation, trace) {
  const recorded = isObject(annotation)
  const turns = safeArray(annotation?.turns).map((record) => normalizeTurn(record, trace))
  const tools = safeArray(annotation?.tools).map((record) => normalizeTool(record, trace))
  const skills = safeArray(annotation?.skills).map((record) => normalizeSkill(record, trace))
  const captured = capturedEvidenceCounts(trace)
  const performanceSummary = countVerdicts(turns, 'performance', ['improved', 'neutral', 'worsened', 'unclear']).map((item) => ({
    ...item,
    turnIds: turns.filter((turn) => turn.performance === item.value).map((turn) => turn.turnId || turn.eventId),
    turns: turns.filter((turn) => turn.performance === item.value).map((turn) => ({
      id: turn.turnId || turn.eventId,
      role: turn.turnRole,
      preview: turn.turnPreview,
    })),
  }))

  return {
    recorded,
    schemaVersion: cleanString(annotation?.schema_version ?? annotation?.schemaVersion) || null,
    source: cleanString(annotation?.source) || null,
    performanceSummary,
    performanceLabeledCount: performanceSummary.reduce((total, item) => total + item.count, 0),
    categories: [
      normalizeCategory('turns', 'Agent turns', turns, captured.turns, [
        { label: 'Follows instructions', key: 'followsInstructions', values: ['yes', 'no', 'unclear'] },
        { label: 'Performance', key: 'performance', values: ['improved', 'neutral', 'worsened', 'unclear'] },
      ]),
      normalizeCategory('tools', 'Tool calls', tools, captured.tools, [
        { label: 'Necessary', key: 'necessary', values: ['yes', 'no', 'unclear'] },
      ]),
      normalizeCategory('skills', 'Skill invocations', skills, captured.skills, [
        { label: 'Necessary', key: 'necessary', values: ['yes', 'no', 'unclear'] },
      ]),
    ],
  }
}

function displayVerdict(value) {
  if (value === 'pass') return 'Pass'
  if (value === 'fail') return 'Fail'
  if (value === 'unknown') return 'Unknown'
  return 'Not recorded'
}

function normalizeReviewSignal(record = {}, trace = {}, annotation) {
  const severity = validEnum(record.severity, new Set(['info', 'warning', 'critical', 'unknown'])) || 'unknown'
  const detail = cleanString(record.detail) || 'Signal detail not recorded'
  const signalName = cleanString(record.name)
  return {
    signalKey: signalName || null,
    name: humanizeSignalName(signalName),
    count: numberOrNull(record.count),
    severity,
    severityMeaning: SIGNAL_SEVERITY_MEANINGS[severity],
    detail: readableSignalDetail(detail, trace),
    occurrenceCount: numberOrNull(record.count),
    occurrences: signalOccurrences(signalName, detail, trace, annotation),
  }
}

function normalizeFollowUp(signal) {
  return {
    signalKey: signal.signalKey,
    title: signal.name,
    action: SIGNAL_FOLLOW_UPS[signal.signalKey] || 'Review this finding and record a concrete resolution.',
    reason: signal.detail,
    occurrenceCount: signal.count,
  }
}

function normalizeAlignment(alignment) {
  const value = isObject(alignment) ? alignment : {}
  const status = validEnum(value.status, ALIGNMENT_STATUSES) || 'not_recorded'
  return {
    status,
    label: status === 'aligned' ? 'Aligned' : status === 'not_aligned' ? 'Not aligned' : 'Not recorded',
    humanLabel: cleanString(value.human_label ?? value.humanLabel) || null,
    evaluatorLabel: cleanString(value.evaluator_label ?? value.evaluatorLabel) || null,
    agreement: typeof value.agreement === 'boolean' ? value.agreement : null,
    dataset: cleanString(value.dataset) || null,
  }
}

function normalizeLedger(ledger) {
  const value = isObject(ledger) ? ledger : {}
  return {
    recorded: isObject(ledger),
    project: cleanString(value.project) || null,
    improvements: safeArray(value.improvements).map((improvement = {}) => ({
      path: cleanString(improvement.path) || 'Path not recorded',
      change: cleanString(improvement.change) || 'Change not recorded',
      reason: cleanString(improvement.reason) || 'Reason not recorded',
    })),
  }
}

function normalizeEvaluation(evaluation, trace, annotation) {
  const recorded = isObject(evaluation)
  const verdict = validEnum(evaluation?.verdict, EVALUATION_VERDICTS)
  const reviewSignals = safeArray(evaluation?.review_signals ?? evaluation?.reviewSignals).map((record) => normalizeReviewSignal(record, trace, annotation))
  return {
    recorded,
    schemaVersion: cleanString(evaluation?.schema_version ?? evaluation?.schemaVersion) || null,
    source: cleanString(evaluation?.source) || null,
    verdict,
    verdictLabel: displayVerdict(verdict),
    critique: cleanString(evaluation?.critique) || null,
    reviewSignals,
    followUps: reviewSignals.filter((signal) => signal.severity === 'warning' || signal.severity === 'critical').map(normalizeFollowUp),
    judgeAlignment: normalizeAlignment(evaluation?.judge_alignment ?? evaluation?.judgeAlignment),
    evaluationLedger: normalizeLedger(evaluation?.evaluation_ledger ?? evaluation?.evaluationLedger),
  }
}

export function normalizeSessionAnalysis(analysis, trace = {}) {
  const value = isObject(analysis) ? analysis : {}
  const annotation = normalizeAnnotation(value.annotation, trace)
  const evaluation = normalizeEvaluation(value.evaluation, trace, value.annotation)

  return {
    recorded: annotation.recorded || evaluation.recorded,
    updatedAt: cleanString(value.updated_at ?? value.updatedAt) || null,
    annotation,
    evaluation,
  }
}
