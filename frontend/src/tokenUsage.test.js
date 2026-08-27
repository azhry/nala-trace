import { describe, expect, it } from 'vitest'
import { hasRecordedTokenUsage, normalizeTokenUsage, tokenUsageCost } from './tokenUsage'

describe('token usage normalization', () => {
  it('keeps an explicitly recorded zero cost visible', () => {
    const usage = normalizeTokenUsage({
      input_tokens: 100,
      total_tokens: 100,
      cost_usd: 0,
      cost_recorded: true,
    })

    expect(usage.costRecorded).toBe(true)
    expect(tokenUsageCost(usage)).toBe('$0.0000')
  })

  it('distinguishes an omitted cost from an explicit zero cost', () => {
    const usage = normalizeTokenUsage({ input_tokens: 100, total_tokens: 100 })

    expect(usage.costRecorded).toBe(false)
    expect(tokenUsageCost(usage)).toBeNull()
    expect(hasRecordedTokenUsage(usage)).toBe(true)
  })

  it('honors a backend cost marker when the payload contains a placeholder zero', () => {
    const usage = normalizeTokenUsage({
      input_tokens: 100,
      total_tokens: 100,
      cost_usd: 0,
      cost_recorded: false,
    })

    expect(usage.costRecorded).toBe(false)
    expect(tokenUsageCost(usage)).toBeNull()
  })
})
