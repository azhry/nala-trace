const USAGE_FIELDS = [
  ['input_tokens', 'inputTokens'],
  ['cached_input_tokens', 'cachedInputTokens'],
  ['output_tokens', 'outputTokens'],
  ['reasoning_tokens', 'reasoningTokens'],
  ['total_tokens', 'totalTokens'],
  ['cost_usd', 'costUsd'],
]
const COST_FIELDS = ['cost_usd', 'costUsd']
const COST_MARKER_FIELDS = ['cost_recorded', 'costRecorded']

export const EMPTY_TOKEN_USAGE = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  costRecorded: false,
})

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function usageValue(source, snakeCaseKey, camelCaseKey) {
  if (source[snakeCaseKey] !== undefined && source[snakeCaseKey] !== null) return source[snakeCaseKey]
  return source[camelCaseKey]
}

function hasValue(source, keys) {
  return keys.some((key) => source[key] !== undefined && source[key] !== null)
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return Boolean(value)
}

export function hasRecordedCost(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return false
  const marker = usageValue(usage, COST_MARKER_FIELDS[0], COST_MARKER_FIELDS[1])
  if (marker !== undefined && marker !== null) return booleanValue(marker)
  return hasValue(usage, COST_FIELDS)
}

export function normalizeTokenUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const hasUsageField = USAGE_FIELDS.some(([snakeCaseKey, camelCaseKey]) => value[snakeCaseKey] !== undefined || value[camelCaseKey] !== undefined)
  if (!hasUsageField) return null

  return {
    ...Object.fromEntries(USAGE_FIELDS.map(([snakeCaseKey, camelCaseKey]) => [camelCaseKey, finiteNumber(usageValue(value, snakeCaseKey, camelCaseKey))])),
    costRecorded: hasRecordedCost(value),
  }
}

export function hasRecordedTokenUsage(usage) {
  if (!usage) return false
  const hasTokenCount = [
    usageValue(usage, 'input_tokens', 'inputTokens'),
    usageValue(usage, 'cached_input_tokens', 'cachedInputTokens'),
    usageValue(usage, 'output_tokens', 'outputTokens'),
    usageValue(usage, 'reasoning_tokens', 'reasoningTokens'),
    usageValue(usage, 'total_tokens', 'totalTokens'),
  ].some((value) => finiteNumber(value) > 0)
  return hasTokenCount || hasRecordedCost(usage) && finiteNumber(usageValue(usage, 'cost_usd', 'costUsd')) > 0
}

export function tokenUsageCost(usage) {
  if (!hasRecordedCost(usage)) return null
  return `$${finiteNumber(usageValue(usage, 'cost_usd', 'costUsd')).toFixed(4)}`
}
