import { describe, expect, it } from 'vitest'
import { extendExpiry, GRACE_SECONDS, isActive, PERIOD_SECONDS } from './periods.ts'

const NOW = 1_800_000_000

describe('extendExpiry', () => {
  it('starts from now when the pledge is new or lapsed', () => {
    expect(extendExpiry(NOW, 0, 1)).toBe(NOW + PERIOD_SECONDS)
    expect(extendExpiry(NOW, NOW - 10, 2)).toBe(NOW + 2 * PERIOD_SECONDS)
  })

  it('extends an active pledge without a gap', () => {
    const expiresAt = NOW + 5 * 24 * 3600
    expect(extendExpiry(NOW, expiresAt, 1)).toBe(expiresAt + PERIOD_SECONDS)
  })

  it('rejects periods outside 1..12', () => {
    expect(() => extendExpiry(NOW, 0, 0)).toThrow(RangeError)
    expect(() => extendExpiry(NOW, 0, 13)).toThrow(RangeError)
    expect(() => extendExpiry(NOW, 0, 1.5)).toThrow(RangeError)
  })
})

describe('isActive', () => {
  it('stays active through the grace window and lapses after it', () => {
    const expiresAt = NOW
    expect(isActive(NOW + GRACE_SECONDS - 1, expiresAt)).toBe(true)
    expect(isActive(NOW + GRACE_SECONDS, expiresAt)).toBe(false)
  })
})
