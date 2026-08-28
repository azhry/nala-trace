import { describe, expect, it } from 'vitest'
import { hasRecordedTokenUsage, normalizeTokenUsage } from './tokenUsage'

describe('token usage normalization', () => {
  it('normalizes the five canonical token counts', () => {
    const usage = normalizeTokenUsage({
      input_tokens: 100,
      cached_input_tokens: 20,
      output_tokens: 40,
      reasoning_tokens: 5,
      total_tokens: 140,
    })

    expect(usage).toEqual({
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 40,
      reasoningTokens: 5,
      totalTokens: 140,
    })
  })

  it('accepts the legacy camel-case token field names', () => {
    expect(normalizeTokenUsage({ inputTokens: 12, totalTokens: 12 })).toEqual({
      inputTokens: 12,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 12,
    })
  })

  it('returns no usage for payloads without recognized token counts', () => {
    expect(normalizeTokenUsage({ provider: 'codex' })).toBeNull()
    expect(hasRecordedTokenUsage(null)).toBe(false)
  })

  it('recognizes usage only when a token count is positive', () => {
    expect(hasRecordedTokenUsage(normalizeTokenUsage({ input_tokens: 0, total_tokens: 0 }))).toBe(false)
    expect(hasRecordedTokenUsage(normalizeTokenUsage({ output_tokens: 1 }))).toBe(true)
  })
})
