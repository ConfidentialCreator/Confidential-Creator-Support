import { describe, expect, it } from 'vitest'
import { LIFT_MS, liftSchedule, STAGGER_MS } from './lift.ts'

describe('liftSchedule', () => {
  it('starts each group after the previous one finished staggering', () => {
    const s = liftSchedule([48, 7])
    expect(s.starts).toEqual([0, 48 * STAGGER_MS])
    expect(s.end).toBe(55 * STAGGER_MS)
    expect(s.settled).toBe(55 * STAGGER_MS + LIFT_MS)
  })

  it('an empty group takes no time', () => {
    expect(liftSchedule([0, 7]).starts).toEqual([0, 0])
  })

  it('no groups settles after one lift', () => {
    expect(liftSchedule([])).toEqual({ starts: [], end: 0, settled: LIFT_MS })
  })
})
