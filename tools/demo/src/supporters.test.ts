import { describe, expect, it } from 'vitest'
import { contributionPlan, percentile, SUPPORTER_UNITS } from './supporters.ts'

describe('contributionPlan', () => {
  it('gives every supporter a first contribution and only the first `repeats` a second', () => {
    expect(contributionPlan(0, 24).repeat).toBeDefined()
    expect(contributionPlan(23, 24).repeat).toBeDefined()
    expect(contributionPlan(24, 24).repeat).toBeUndefined()
    expect(contributionPlan(127, 0).repeat).toBeUndefined()
  })

  it('is deterministic and never round, so the amount cannot collide with a log number', () => {
    const a = contributionPlan(5, 24)
    expect(contributionPlan(5, 24)).toEqual(a)
    for (let i = 0; i < 128; i++) {
      const plan = contributionPlan(i, 24)
      for (const entry of [plan.first, plan.repeat]) {
        if (!entry) continue
        expect(entry.units % 1_000_000n).not.toBe(0n)
        expect(entry.periods).toBeGreaterThanOrEqual(1)
        expect(entry.periods).toBeLessThanOrEqual(12)
      }
    }
  })

  it('fits the whole plan into one faucet portion', () => {
    for (let i = 0; i < 128; i++) {
      const plan = contributionPlan(i, 128)
      expect(plan.first.units + (plan.repeat?.units ?? 0n)).toBeLessThanOrEqual(SUPPORTER_UNITS)
    }
  })
})

describe('percentile', () => {
  it('takes the nearest-rank value', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3)
    expect(percentile([5, 1, 4, 2, 3], 95)).toBe(5)
    expect(percentile([10], 95)).toBe(10)
  })

  it('is zero on an empty sample', () => {
    expect(percentile([], 95)).toBe(0)
  })
})
