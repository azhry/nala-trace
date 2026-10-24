import { getToolInputPreview } from './traceViewModel'

const EMPTY_LIST = []
const TURN_PREVIEW_LIMIT = 240

const ANNOTATION_VERDICTS = new Set(['yes', 'no', 'unclear'])
const PERFORMANCE_VERDICTS = new Set(['improved', 'neutral', 'worsened', 'unclear'])
const EVALUATION_VERDICTS = new Set(['pass', 'fail', 'unknown'])
const ALIGNMENT_STATUSES = new Set(['aligned', 'not_aligned', 'not_recorded'])
const SCOPE_ADHERENCE_VALUES = new Set(['within_scope', 'deviation', 'unclear'])
const VERIFICATION_VALUES = new Set(['verified', 'not_verified', 'not_applicable', 'unclear', 'partial'])
const USER_SIGNAL_TYPES = new Set(['request', 'constraint', 'clarification', 'correction', 'approval', 'rejection', 'feedback', 'other', 'unclear'])
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
  unmatched_tool_hook_pairs: 'Keep tool necessity marked unknown when the completion event is missing, and verify the event pair before relying on that tool result.',
  unverified_authenticated_browser_flow: 'For browser-dependent work, run the authenticated desktop and mobile checks and record what each one showed.',
  delivery_branch_collision_recovered: 'Before handoff, verify that the final branch and pull request use the requested base and contain the intended changes.',
}
const AGENT_TARGET_LABELS = new Map([
  ['agent', 'Agent behavior'],
  ['agent behavior', 'Agent behavior'],
  ['agent action', 'Agent behavior'],
  ['agent actions', 'Agent behavior'],
  ['instructions', 'Agent instructions'],
  ['instruction', 'Agent instructions'],
  ['agent instruction file', 'Agent instructions'],
  ['agent instructions file', 'Agent instructions'],
  ['agent instruction', 'Agent instructions'],
  ['agent instructions', 'Agent instructions'],
  ['skill', 'Skill instructions'],
  ['skills', 'Skill instructions'],
  ['skill instruction', 'Skill instructions'],
  ['skill instructions', 'Skill instructions'],
  ['workflow', 'Workflow instructions'],
  ['workflows', 'Workflow instructions'],
  ['workflow instruction', 'Workflow instructions'],
  ['workflow instructions', 'Workflow instructions'],
])

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function schemaVersion(value) {
  const raw = typeof value === 'number' ? String(value) : cleanString(value)
  return raw.toLowerCase().replace(/^v/, '') || null
}

function normalizedPath(value) {
  return cleanString(value).replace(/\\/g, '/').replace(/^\.\//, '')
}

function agentRelativePath(value) {
  const path = normalizedPath(value)
  const lowerPath = path.toLowerCase()
  const markers = ['/.agents/', '/.codex/', '/.claude/', '/.cursor/']
  const markerIndex = Math.max(...markers.map((marker) => lowerPath.lastIndexOf(marker)))
  return markerIndex === -1 ? path : path.slice(markerIndex + 1)
}

function targetKey(value) {
  return cleanString(value).toLowerCase().replace(/[-_]+/g, ' ')
}

function instructionPathTarget(path) {
  const relativePath = agentRelativePath(path)
  const lowerPath = relativePath.toLowerCase()
  if (lowerPath === 'agents.md' || lowerPath === 'claude.md' || lowerPath === 'codex.md') {
    return { kind: 'instruction', label: 'Agent instructions', target: relativePath, path: relativePath }
  }
  if (/^(?:\.agents\/skills|\.codex\/skills|\.claude\/skills|\.cursor\/skills)\/.+\.md$/i.test(relativePath)) {
    return { kind: 'skill', label: 'Skill instructions', target: relativePath, path: relativePath }
  }
  if (/^(?:\.agents\/workflows|\.codex\/workflows|\.claude\/workflows|\.cursor\/workflows)\/.+\.md$/i.test(relativePath)) {
    return { kind: 'workflow', label: 'Workflow instructions', target: relativePath, path: relativePath }
  }
  if (/^(?:\.agents|\.codex|\.claude|\.cursor)\/.+\.md$/i.test(relativePath)) {
    return { kind: 'instruction', label: 'Agent instructions', target: relativePath, path: relativePath }
  }
  return null
}

function classifyImprovementTarget(improvement = {}) {
  const path = normalizedPath(improvement.path ?? improvement.file ?? improvement.destination)
  const explicitTarget = targetKey(improvement.target ?? improvement.target_type ?? improvement.targetType)
  const pathTarget = targetKey(path)
  const explicitLabel = AGENT_TARGET_LABELS.get(explicitTarget)
  const pathInstructionTarget = instructionPathTarget(path)

  if (explicitLabel && (!path || explicitTarget === 'agent' || explicitTarget === 'agent behavior' || explicitTarget === 'agent action' || explicitTarget === 'agent actions' || pathInstructionTarget)) {
    if (pathInstructionTarget) return { valid: true, ...pathInstructionTarget }
    const kind = explicitLabel === 'Skill instructions' ? 'skill' : explicitLabel === 'Workflow instructions' ? 'workflow' : explicitLabel === 'Agent instructions' ? 'instruction' : 'agent'
    return { valid: true, kind, label: explicitLabel, target: explicitLabel, path: null }
  }

  if (pathInstructionTarget) return { valid: true, ...pathInstructionTarget }

  if (AGENT_TARGET_LABELS.has(pathTarget)) {
    const label = AGENT_TARGET_LABELS.get(pathTarget)
    return { valid: true, kind: label === 'Skill instructions' ? 'skill' : label === 'Workflow instructions' ? 'workflow' : label === 'Agent instructions' ? 'instruction' : 'agent', label, target: label, path: null }
  }

  return {
    valid: false,
    kind: 'legacy_out_of_scope',
    label: 'Out of scope — project source',
    target: path || 'Target not recorded',
    path: path || null,
    reason: path
      ? 'This saved action points to project source, so it is shown for traceability only and excluded from agent improvements.'
      : 'This saved action has no agent behavior or instruction Markdown target, so it is shown for traceability only and excluded from agent improvements.',
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : EMPTY_LIST
}

function validEnum(value, allowed) {
  const normalized = cleanString(value).toLowerCase()
  return allowed.has(normalized) ? normalized : null
}

function normalizedEnum(value, allowed, aliases = {}) {
  const normalized = normalizedValue(value)
  const canonical = aliases[normalized] || normalized
  return allowed.has(canonical) ? canonical : null
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

function stringList(value) {
  return safeArray(value).map(cleanString).filter(Boolean)
}

function normalizedValue(value) {
  return cleanString(value).toLowerCase().replace(/[\s-]+/g, '_') || null
}

function humanizeValue(value) {
  return cleanString(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function humanizeSignalName(value) {
  const normalized = cleanString(value)
  if (!normalized) return 'Unnamed signal'
  if (SIGNAL_NAME_LABELS[normalized]) return SIGNAL_NAME_LABELS[normalized]
  if (!normalized.includes('_')) return normalized
  return normalized.split('_').map((word) => word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : '').join(' ')
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function countDistinctTurnEvidence(trace, role) {
  if (!Array.isArray(trace?.conversation)) return null

  const conversation = trace.conversation.filter((item) => {
    const itemRole = cleanString(item?.role).toLowerCase()
    return itemRole === role
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

function capturedSummaryCount(trace, summaryKeys) {
  for (const key of summaryKeys) {
    const count = numberOrNull(trace?.summary?.[key])
    if (count !== null) return count
  }
  return null
}

function capturedEvidenceCounts(trace = {}, annotation = {}) {
  const explicit = annotation.captured_counts ?? annotation.capturedCounts ?? annotation.capture_counts ?? annotation.captureCounts ?? {}
  const read = (key, collection, summaryKeys, fallback) => numberOrNull(explicit[key]) ?? capturedCount(trace, collection, summaryKeys, fallback)
  return {
    user_turns: numberOrNull(explicit.user_turns) ?? countDistinctTurnEvidence(trace, 'user') ?? capturedSummaryCount(trace, ['user_turn_count', 'userTurnCount']),
    turns: numberOrNull(explicit.turns) ?? countDistinctTurnEvidence(trace, 'assistant') ?? capturedSummaryCount(trace, ['assistant_turn_count', 'assistantTurnCount']),
    tools: read('tools', 'tool_calls', ['tool_call_count', 'toolCallCount'], null),
    skills: read('skills', 'skill_invocations', ['skill_invocation_count', 'skillInvocationCount'], null),
    files: read('files', 'files', ['file_operation_count', 'fileOperationCount'], null),
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
  const responseSummary = clipTurnPreview(record.response_summary ?? record.responseSummary ?? conversationItem?.content) || null
  return {
    eventId: cleanString(record.event_id ?? record.eventId) || 'Event ID not recorded',
    turnId,
    turnRole: cleanString(record.role ?? record.speaker ?? conversationItem?.role).toLowerCase() || 'assistant',
    turnPreview: responseSummary,
    responseSummary,
    followsInstructions: validEnum(record.follows_instructions ?? record.followsInstructions, ANNOTATION_VERDICTS),
    scopeAdherence: normalizedEnum(record.scope_adherence ?? record.scopeAdherence, SCOPE_ADHERENCE_VALUES, { deviated: 'deviation' }),
    groundedness: normalizedValue(record.groundedness),
    verification: normalizedEnum(record.verification, VERIFICATION_VALUES, { unverified: 'not_verified' }),
    performance: validEnum(record.performance, PERFORMANCE_VERDICTS),
    relatedEventIds: stringList(record.related_event_ids ?? record.relatedEventIds),
    rationale: cleanString(record.rationale) || null,
  }
}

function normalizeUserTurn(record = {}) {
  const signalType = normalizedEnum(record.signal_type ?? record.signalType ?? record.type, USER_SIGNAL_TYPES, { scope_clarification: 'clarification' })
  return {
    eventId: cleanString(record.event_id ?? record.eventId) || 'Event ID not recorded',
    turnId: cleanString(record.turn_id ?? record.turnId) || null,
    signalType: humanizeValue(signalType) || 'Other',
    summary: clipTurnPreview(record.summary ?? record.user_summary ?? record.userSummary ?? record.content) || null,
    relatedEventIds: stringList(record.related_event_ids ?? record.relatedEventIds),
    rationale: cleanString(record.rationale) || null,
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
  const inputSummary = clipTurnPreview(record.input_summary ?? record.inputSummary) || (inputPreview?.kind === 'missing' ? null : inputPreview?.text || null)
  const outputSummary = clipTurnPreview(record.output_summary ?? record.outputSummary) || null
  const completionStatus = cleanString(record.completion_status ?? record.completionStatus ?? toolCall?.status ?? toolCall?.tool_status).toLowerCase() || null
  const completionDetails = {
    completed: 'The tool call completed.',
    incomplete: 'The tool call was recorded, but its completion evidence is incomplete.',
    failed: 'The tool call failed.',
    unknown: 'The saved analysis could not determine whether the tool call completed.',
    unmatched: 'No matching completion hook was captured; the invocation is present but its completion evidence is incomplete.',
  }
  const completionDetail = completionStatus
    ? completionDetails[completionStatus] || `Captured completion status: ${humanizeValue(completionStatus)}.`
    : 'Completion status not recorded.'
  return {
    eventId: cleanString(record.event_id ?? record.eventId) || 'Event ID not recorded',
    toolUseId,
    toolName,
    inputPreview: inputSummary,
    inputPreviewLabel: inputPreview?.kind === 'missing' ? null : inputPreview?.label || null,
    outputSummary,
    completionStatus,
    completionDetail,
    necessary: validEnum(record.necessary, ANNOTATION_VERDICTS),
    rationale: cleanString(record.rationale) || null,
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
    summary: clipTurnPreview(record.summary ?? record.skill_summary ?? record.skillSummary) || null,
    invocationDetail,
    necessary: validEnum(record.necessary, ANNOTATION_VERDICTS),
    rationale: cleanString(record.rationale) || null,
  }
}

function normalizeFile(record = {}) {
  return {
    eventId: cleanString(record.event_id ?? record.eventId) || 'Event ID not recorded',
    path: cleanString(record.path ?? record.file_path ?? record.filePath) || 'File path not recorded',
    operation: humanizeValue(record.operation) || 'Operation not recorded',
    summary: clipTurnPreview(record.summary ?? record.file_summary ?? record.fileSummary) || null,
    necessary: validEnum(record.necessary ?? record.relevance, ANNOTATION_VERDICTS),
    rationale: cleanString(record.rationale) || null,
  }
}

function normalizeCaptureGap(record = {}) {
  return {
    category: humanizeValue(record.category) || 'Evidence category not recorded',
    eventIds: stringList(record.event_ids ?? record.eventIds),
    summary: clipTurnPreview(record.summary) || null,
    impact: clipTurnPreview(record.impact) || null,
  }
}

const UNCLEAR_FIELDS = [
  'followsInstructions',
  'scopeAdherence',
  'groundedness',
  'verification',
  'performance',
  'necessary',
]

function unclearRecordCount(records) {
  return records.filter((record) => UNCLEAR_FIELDS.some((key) => normalizedValue(record[key]) === 'unclear')).length
}

function countVerdicts(records, key, values) {
  return values.map((value) => ({
    value,
    count: records.filter((record) => record[key] === value).length,
  }))
}

function coverageCopy(annotatedCount, capturedCountValue, isRecorded) {
  const annotated = annotatedCount.toLocaleString()
  if (!isRecorded) return { value: 'Not included', detail: 'This category was not stored in this analysis version' }
  if (capturedCountValue === null) return { value: `${annotated} labeled`, detail: 'Captured total is not included in this response' }
  if (capturedCountValue === 0) return { value: `${annotated} labeled / 0 captured`, detail: 'No captured records in this category' }
  const percentage = Math.round((annotatedCount / capturedCountValue) * 100)
  return {
    value: `${annotated} labeled / ${capturedCountValue.toLocaleString()} captured`,
    detail: `${percentage}% of captured records labeled`,
  }
}

function normalizeCategory(key, label, records, capturedCountValue, fields, isRecorded = true, unavailableDetail = null, savedCoverage = null) {
  const annotatedCount = numberOrNull(savedCoverage?.labeled) ?? records.length
  const capturedCount = numberOrNull(savedCoverage?.captured) ?? capturedCountValue
  const unclearCount = numberOrNull(savedCoverage?.unclear) ?? unclearRecordCount(records)
  const coverage = coverageCopy(annotatedCount, capturedCount, isRecorded)
  return {
    key,
    label,
    records,
    recorded: isRecorded,
    unavailableDetail,
    annotatedCount,
    capturedCount,
    unclearCount,
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
  const version = schemaVersion(annotation?.schema_version ?? annotation?.schemaVersion)
  const version2 = version === '2'
  const captureGapsRecorded = Array.isArray(annotation?.capture_gaps ?? annotation?.captureGaps)
  const userTurnsRecorded = Array.isArray(annotation?.user_turns ?? annotation?.userTurns)
  const turnsRecorded = Array.isArray(annotation?.turns)
  const toolsRecorded = Array.isArray(annotation?.tools)
  const skillsRecorded = Array.isArray(annotation?.skills)
  const filesRecorded = Array.isArray(annotation?.files)
  const userTurns = safeArray(annotation?.user_turns ?? annotation?.userTurns).map(normalizeUserTurn)
  const turns = safeArray(annotation?.turns).map((record) => normalizeTurn(record, trace))
  const tools = safeArray(annotation?.tools).map((record) => normalizeTool(record, trace))
  const skills = safeArray(annotation?.skills).map((record) => normalizeSkill(record, trace))
  const files = safeArray(annotation?.files).map(normalizeFile)
  const captureGaps = safeArray(annotation?.capture_gaps ?? annotation?.captureGaps).map(normalizeCaptureGap)
  const savedCoverage = isObject(annotation?.coverage) ? annotation.coverage : {}
  const captured = version2
    ? {
        user_turns: numberOrNull(savedCoverage.user_turns?.captured) ?? userTurns.length,
        turns: numberOrNull(savedCoverage.agent_turns?.captured) ?? turns.length,
        tools: numberOrNull(savedCoverage.tool_calls?.captured) ?? tools.length,
        skills: numberOrNull(savedCoverage.skill_invocations?.captured) ?? skills.length,
        files: numberOrNull(savedCoverage.file_operations?.captured) ?? files.length,
      }
    : capturedEvidenceCounts(trace, annotation || {})
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
    schemaVersion: version,
    source: cleanString(annotation?.source) || null,
    captureGaps,
    captureGapsRecorded,
    performanceSummary,
    performanceLabeledCount: performanceSummary.reduce((total, item) => total + item.count, 0),
    categories: [
      normalizeCategory('user_turns', 'User turns', userTurns, captured.user_turns, [], userTurnsRecorded, version === '1' ? 'User intent and feedback were not represented by schema v1.' : 'User-turn records were not included.', version2 ? savedCoverage.user_turns : null),
      normalizeCategory('turns', 'Agent turns', turns, captured.turns, [
        { label: 'Follows instructions', key: 'followsInstructions', values: ['yes', 'no', 'unclear'] },
        { label: 'Scope adherence', key: 'scopeAdherence', values: ['within_scope', 'deviation', 'unclear'] },
        { label: 'Grounding', key: 'groundedness', values: ['supported', 'unsupported', 'unclear'] },
        { label: 'Verification', key: 'verification', values: ['verified', 'not_verified', 'not_applicable', 'partial', 'unclear'] },
        { label: 'Performance', key: 'performance', values: ['improved', 'neutral', 'worsened', 'unclear'] },
      ], turnsRecorded, version === '1' ? null : 'Agent-turn records were not included.', version2 ? savedCoverage.agent_turns : null),
      normalizeCategory('tools', 'Tool calls', tools, captured.tools, [
        { label: 'Necessary', key: 'necessary', values: ['yes', 'no', 'unclear'] },
      ], toolsRecorded, version === '1' ? null : 'Tool records were not included.', version2 ? savedCoverage.tool_calls : null),
      normalizeCategory('skills', 'Skill invocations', skills, captured.skills, [
        { label: 'Necessary', key: 'necessary', values: ['yes', 'no', 'unclear'] },
      ], skillsRecorded, version === '1' ? null : 'Skill records were not included.', version2 ? savedCoverage.skill_invocations : null),
      normalizeCategory('files', 'File operations', files, captured.files, [
        { label: 'Needed for task', key: 'necessary', values: ['yes', 'no', 'unclear'] },
      ], filesRecorded, version === '1' ? 'File decisions were not represented by schema v1.' : 'File records were not included.', version2 ? savedCoverage.file_operations : null),
    ],
  }
}

function displayVerdict(value) {
  if (value === 'pass') return 'Pass'
  if (value === 'fail') return 'Fail'
  if (value === 'unknown') return 'Unknown'
  return 'Not recorded'
}

function normalizeReviewSignal(record = {}) {
  const severity = validEnum(record.severity, new Set(['info', 'warning', 'critical', 'unknown'])) || 'unknown'
  const detail = cleanString(record.detail) || 'Signal detail not recorded'
  const signalName = cleanString(record.name)
  const occurrences = safeArray(record.occurrences).map((occurrence = {}) => ({
    eventId: cleanString(occurrence.event_id ?? occurrence.eventId) || 'Event ID not recorded',
    eventKind: humanizeValue(occurrence.event_kind ?? occurrence.eventKind) || null,
    summary: clipTurnPreview(occurrence.summary) || null,
    impact: clipTurnPreview(occurrence.impact) || null,
    occurredAt: cleanString(occurrence.occurred_at ?? occurrence.occurredAt) || null,
  }))
  const count = numberOrNull(record.count) ?? (Array.isArray(record.occurrences) ? occurrences.length : null)
  return {
    signalKey: signalName || null,
    name: humanizeSignalName(signalName),
    count,
    severity,
    severityMeaning: SIGNAL_SEVERITY_MEANINGS[severity],
    detail,
    occurrenceCount: count,
    occurrences,
  }
}

function normalizeFollowUp(signal) {
  return {
    signalKey: signal.signalKey,
    title: signal.name,
    action: SIGNAL_FOLLOW_UPS[signal.signalKey] || 'Review this finding and record a concrete resolution.',
    reason: signal.detail,
    occurrenceCount: signal.count,
    targetLabel: 'Agent behavior',
    evidenceEventIds: stringList(signal.occurrences.map((occurrence) => occurrence.eventId).filter((eventId) => eventId !== 'Event ID not recorded')),
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
  const improvements = safeArray(value.improvements).map((improvement = {}) => {
    const target = classifyImprovementTarget(improvement)
    return {
      path: target.path,
      target: target.target,
      targetKind: target.kind,
      targetLabel: target.label,
      targetValid: target.valid,
      outOfScopeReason: target.reason || null,
      change: cleanString(improvement.change) || 'Change not recorded',
      reason: cleanString(improvement.reason) || 'Reason not recorded',
      evidenceEventIds: stringList(improvement.evidence_event_ids ?? improvement.evidenceEventIds),
    }
  })
  return {
    recorded: isObject(ledger),
    project: cleanString(value.project) || null,
    projectContextOnly: true,
    improvements: improvements.filter((improvement) => improvement.targetValid),
    legacyImprovements: improvements.filter((improvement) => !improvement.targetValid),
  }
}

function normalizeEvaluation(evaluation) {
  const recorded = isObject(evaluation)
  const verdict = validEnum(evaluation?.verdict, EVALUATION_VERDICTS)
  const reviewSignals = safeArray(evaluation?.review_signals ?? evaluation?.reviewSignals).map(normalizeReviewSignal)
  return {
    recorded,
    schemaVersion: schemaVersion(evaluation?.schema_version ?? evaluation?.schemaVersion),
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
  const evaluation = normalizeEvaluation(value.evaluation)

  return {
    recorded: annotation.recorded || evaluation.recorded,
    updatedAt: cleanString(value.updated_at ?? value.updatedAt) || null,
    annotation,
    evaluation,
  }
}
