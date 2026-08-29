import { getToolInputPreview } from './traceViewModel'

const EMPTY_LIST = []

const ANNOTATION_VERDICTS = new Set(['yes', 'no', 'unclear'])
const PERFORMANCE_VERDICTS = new Set(['improved', 'neutral', 'worsened', 'unclear'])
const EVALUATION_VERDICTS = new Set(['pass', 'fail', 'unknown'])
const ALIGNMENT_STATUSES = new Set(['aligned', 'not_aligned', 'not_recorded'])

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

function normalizeTurn(record = {}) {
  return {
    eventId: cleanString(record.event_id ?? record.eventId) || 'Event ID not recorded',
    turnId: cleanString(record.turn_id ?? record.turnId) || null,
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

function normalizeTool(record = {}, trace = {}) {
  const toolCall = linkedToolCall(trace, record)
  const toolName = cleanString(record.tool_name ?? record.toolName) || cleanString(toolCall?.tool_name ?? toolCall?.toolName) || null
  const toolUseId = cleanString(record.tool_use_id ?? record.toolUseId) || cleanString(toolCall?.tool_use_id ?? toolCall?.toolUseId) || null
  const input = record.input ?? record.tool_input ?? toolCall?.input
  const inputPreview = input == null ? null : getToolInputPreview(toolName || '', input)
  return {
    eventId: cleanString(record.event_id ?? record.eventId) || 'Event ID not recorded',
    toolUseId,
    toolName,
    inputPreview: inputPreview?.kind === 'missing' ? null : inputPreview?.text || null,
    inputPreviewLabel: inputPreview?.kind === 'missing' ? null : inputPreview?.label || null,
    necessary: validEnum(record.necessary, ANNOTATION_VERDICTS),
    rationale: cleanString(record.rationale) || 'Rationale not recorded',
  }
}

function normalizeSkill(record = {}) {
  return {
    eventId: cleanString(record.event_id ?? record.eventId) || 'Event ID not recorded',
    skillName: cleanString(record.skill_name ?? record.skillName) || 'Skill name not recorded',
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
      values: countVerdicts(records, fieldKey, values),
    })),
  }
}

function normalizeAnnotation(annotation, trace) {
  const recorded = isObject(annotation)
  const turns = safeArray(annotation?.turns).map(normalizeTurn)
  const tools = safeArray(annotation?.tools).map((record) => normalizeTool(record, trace))
  const skills = safeArray(annotation?.skills).map(normalizeSkill)
  const captured = capturedEvidenceCounts(trace)
  const performanceSummary = countVerdicts(turns, 'performance', ['improved', 'neutral', 'worsened', 'unclear']).map((item) => ({
    ...item,
    turnIds: turns.filter((turn) => turn.performance === item.value).map((turn) => turn.turnId || turn.eventId),
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

function normalizeReviewSignal(record = {}) {
  return {
    name: cleanString(record.name) || 'Unnamed signal',
    count: numberOrNull(record.count),
    severity: validEnum(record.severity, new Set(['info', 'warning', 'critical', 'unknown'])) || 'unknown',
    detail: cleanString(record.detail) || 'Signal detail not recorded',
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

function normalizeEvaluation(evaluation) {
  const recorded = isObject(evaluation)
  const verdict = validEnum(evaluation?.verdict, EVALUATION_VERDICTS)
  return {
    recorded,
    schemaVersion: cleanString(evaluation?.schema_version ?? evaluation?.schemaVersion) || null,
    source: cleanString(evaluation?.source) || null,
    verdict,
    verdictLabel: displayVerdict(verdict),
    critique: cleanString(evaluation?.critique) || null,
    reviewSignals: safeArray(evaluation?.review_signals ?? evaluation?.reviewSignals).map(normalizeReviewSignal),
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
