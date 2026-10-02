import { PERIOD_SECONDS } from '@ccsupport/shared'
import { describe, expect, it } from 'vitest'
import { judgeRenewal, type RenewalSample } from './renewal.ts'

const OLD = '2026-11-01T12:00:00.000Z'
const NEW = new Date(Date.parse(OLD) + PERIOD_SECONDS * 1000).toISOString()
const BEFORE = { expiresAt: OLD, activeSupporters: 350 }
const CONFIRMED = 10_000

const sample = (atMs: number, patch: Partial<RenewalSample> = {}): RenewalSample => ({
  atMs,
  active: true,
  expiresAt: atMs < 12_000 ? OLD : NEW,
  activeSupporters: 350,
  ...patch,
})
const around = [8_000, 9_000, 10_500, 11_500, 12_500, 13_500].map((at) => sample(at))

describe('judgeRenewal', () => {
  it('passes a renewal that stays active and lands one period after the old expiry', () => {
    const verdict = judgeRenewal(BEFORE, CONFIRMED, around)
    expect(verdict).toMatchObject({
      samples: 6,
      inactive: 0,
      expectedExpiresAt: NEW,
      indexedMs: 2_500,
      counterMoves: 0,
      pass: true,
    })
  })

  it('fails on a single lapsed reading', () => {
    const samples = around.map((s, i) => (i === 3 ? { ...s, active: false } : s))
    expect(judgeRenewal(BEFORE, CONFIRMED, samples)).toMatchObject({ inactive: 1, pass: false })
  })

  it('fails when the expiry was extended from now instead of the old date', () => {
    const fromNow = new Date(Date.parse(OLD) + PERIOD_SECONDS * 1000 - 86_400_000).toISOString()
    const samples = around.map((s) => (s.atMs >= 12_000 ? { ...s, expiresAt: fromNow } : s))
    expect(judgeRenewal(BEFORE, CONFIRMED, samples)).toMatchObject({ indexedMs: null, pass: false })
  })

  it('fails when the counter moves around the renewal', () => {
    const samples = around.map((s) => (s.atMs === 10_500 ? { ...s, activeSupporters: 349 } : s))
    expect(judgeRenewal(BEFORE, CONFIRMED, samples)).toMatchObject({ counterMoves: 1, pass: false })
  })

  it('does not count readings from before the confirmation as indexed', () => {
    const early = [sample(9_500, { expiresAt: NEW }), sample(10_200, { expiresAt: OLD })]
    expect(judgeRenewal(BEFORE, CONFIRMED, early).indexedMs).toBeNull()
  })

  it('fails without a reading before the transaction', () => {
    const after = around.filter((s) => s.atMs > CONFIRMED)
    expect(judgeRenewal(BEFORE, CONFIRMED, after).pass).toBe(false)
  })
})
