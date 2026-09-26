import { GRACE_SECONDS, PERIOD_SECONDS } from '@ccsupport/shared'
import { describe, expect, it } from 'vitest'
import { expiryLines, expiryPlan, formatExpiry } from './expiry.ts'

const NOW = 1_800_000_000
const DAY = 24 * 60 * 60

describe('expiryPlan', () => {
  it('starts a first pledge from now', () => {
    expect(expiryPlan(NOW, null, 3)).toEqual({ kind: 'first', until: NOW + 3 * PERIOD_SECONDS })
  })

  it('extends an active pledge from its expiry, not from now', () => {
    const expiresAt = NOW + 10 * DAY
    expect(expiryPlan(NOW, { expiresAt }, 1)).toEqual({
      kind: 'renewal',
      from: expiresAt,
      until: expiresAt + PERIOD_SECONDS,
    })
  })

  it('starts from now once the paid term is over, grace included', () => {
    const inGrace = { expiresAt: NOW - GRACE_SECONDS + 1 }
    expect(expiryPlan(NOW, inGrace, 2)).toEqual({
      kind: 'lapsed',
      endedAt: inGrace.expiresAt,
      until: NOW + 2 * PERIOD_SECONDS,
    })
    expect(expiryPlan(NOW, { expiresAt: NOW }, 1)).toMatchObject({ kind: 'lapsed' })
  })

  it('refuses periods outside 1..12 like the program does', () => {
    expect(() => expiryPlan(NOW, null, 0)).toThrow(RangeError)
    expect(() => expiryPlan(NOW, { expiresAt: NOW + DAY }, 13)).toThrow(RangeError)
  })
})

describe('formatExpiry', () => {
  it('prints day, month, year and minutes in the given zone', () => {
    const at = Date.UTC(2026, 9, 14, 15, 57, 26) / 1000
    expect(formatExpiry(at, 'UTC')).toBe('14 Oct 2026, 15:57')
    expect(formatExpiry(at, 'Europe/Kyiv')).toBe('14 Oct 2026, 18:57')
  })
})

describe('expiryLines', () => {
  const fmt = (seconds: number) => `<${seconds}>`

  it('names only the new date for a first pledge', () => {
    expect(expiryLines({ kind: 'first', until: 5 }, fmt)).toEqual([
      'Your support will run until <5>.',
    ])
  })

  it('shows both dates of a renewal and says it counts from the old one', () => {
    expect(expiryLines({ kind: 'renewal', from: 3, until: 9 }, fmt)).toEqual([
      'Your support runs until <3>.',
      'This renewal extends it from that date, not from today — until <9>.',
    ])
  })

  it('says a lapsed pledge restarts today', () => {
    expect(expiryLines({ kind: 'lapsed', endedAt: 2, until: 8 }, fmt)).toEqual([
      'Your support ended on <2>.',
      'A renewal now starts from today — until <8>.',
    ])
  })
})
