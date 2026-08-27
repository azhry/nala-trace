const USAGE_FIELDS = [
  ['input_tokens', 'inputTokens'],
  ['cached_input_tokens', 'cachedInputTokens'],
  ['output_tokens', 'outputTokens'],
  ['reasoning_tokens', 'reasoningTokens'],
  ['total_tokens', 'totalTokens'],
]

export const EMPTY_TOKEN_USAGE = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
})

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function usageValue(source, snakeCaseKey, camelCaseKey) {
  if (source[snakeCaseKey] !== undefined && source[snakeCaseKey] !== null) return source[snakeCaseKey]
  return source[camelCaseKey]
}

export function normalizeTokenUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const hasUsageField = USAGE_FIELDS.some(([snakeCaseKey, camelCaseKey]) => value[snakeCaseKey] !== undefined || value[camelCaseKey] !== undefined)
  if (!hasUsageField) return null

  return Object.fromEntries(USAGE_FIELDS.map(([snakeCaseKey, camelCaseKey]) => [camelCaseKey, finiteNumber(usageValue(value, snakeCaseKey, camelCaseKey))]))
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
  return hasTokenCount
}
