import { PERIOD_SECONDS } from '@ccsupport/shared'
import { describe, expect, it } from 'vitest'
import { type AmountRow, decodeHalf, formatSeconds, receivedTotals } from './summary.ts'

const NOW = new Date('2026-09-15T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

const row = (blockTime: string, amount: AmountRow['amount']): AmountRow => ({ blockTime, amount })

describe('receivedTotals', () => {
  it('sums the decrypted amounts inside the current 30 days separately from all time', () => {
    const rows = [
      row(daysAgo(1), { ok: true, units: 5_000_000n }),
      row(daysAgo(29), { ok: true, units: 1_000_000n }),
      row(daysAgo(31), { ok: true, units: 7_000_000n }),
    ]
    expect(receivedTotals(rows, NOW)).toEqual({
      period: 6_000_000n,
      periodCount: 2,
      lifetime: 13_000_000n,
      decrypted: 3,
      failed: 0,
      pending: 0,
    })
  })

  it('treats the period edge as the last PERIOD_SECONDS, inclusive of the boundary second', () => {
    const edge = new Date(NOW.getTime() - PERIOD_SECONDS * 1000).toISOString()
    const beyond = new Date(NOW.getTime() - PERIOD_SECONDS * 1000 - 1000).toISOString()
    const totals = receivedTotals(
      [row(edge, { ok: true, units: 1n }), row(beyond, { ok: true, units: 2n })],
      NOW,
    )
    expect(totals.period).toBe(1n)
    expect(totals.lifetime).toBe(3n)
  })

  it('counts what is still sealed and what failed without adding them', () => {
    const totals = receivedTotals(
      [
        row(daysAgo(1), undefined),
        row(daysAgo(2), { ok: false, reason: 'wrong-key' }),
        row(daysAgo(3), { ok: true, units: 4n }),
      ],
      NOW,
    )
    expect(totals).toEqual({
      period: 4n,
      periodCount: 1,
      lifetime: 4n,
      decrypted: 1,
      failed: 1,
      pending: 1,
    })
  })

  it('is all zeros for no contributions', () => {
    expect(receivedTotals([], NOW)).toEqual({
      period: 0n,
      periodCount: 0,
      lifetime: 0n,
      decrypted: 0,
      failed: 0,
      pending: 0,
    })
  })
})

describe('decodeHalf', () => {
  it('decodes 128 bytes of base64 as the api sends them', () => {
    const bytes = Uint8Array.from({ length: 128 }, (_, i) => i)
    expect(decodeHalf(Buffer.from(bytes).toString('base64'))).toEqual(bytes)
  })

  it('throws on any other length: the schema promised 128 bytes', () => {
    expect(() => decodeHalf(Buffer.alloc(64).toString('base64'))).toThrow(/128/)
  })
})

describe('formatSeconds', () => {
  it('shows one decimal', () => {
    expect(formatSeconds(0)).toBe('0.0 s')
    expect(formatSeconds(4_432)).toBe('4.4 s')
    expect(formatSeconds(12_345)).toBe('12.3 s')
  })
})
