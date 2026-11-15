import { describe, expect, it } from 'vitest'
import { normalizeCapturedEventId } from './eventIds'

describe('normalizeCapturedEventId', () => {
  it.each([
    ['ObjectID("ABCDEF0123456789ABCDEF01")', 'abcdef0123456789abcdef01'],
    ["ObjectId('abcdef0123456789abcdef01')", 'abcdef0123456789abcdef01'],
    ['ABCDEF0123456789ABCDEF01', 'abcdef0123456789abcdef01'],
    ['event-without-object-id', 'event-without-object-id'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeCapturedEventId(input)).toBe(expected)
  })
})
