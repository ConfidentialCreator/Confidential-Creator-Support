import { GRACE_SECONDS } from '@ccsupport/shared'
import { describe, expect, it } from 'vitest'
import { reminder, SOON_DAYS, splitPledges, standing } from './pledges.ts'

const DAY = 24 * 60 * 60
const EXPIRES = 1_800_000_000
const format = (seconds: number) => `<${seconds}>`

function row(active: boolean, daysLeft: number, handle = 'marrow-dispatch') {
  return { handle, active, daysLeft, expiresAt: new Date(EXPIRES * 1000).toISOString() }
}

describe('standing', () => {
  it('runs quietly while more than a week is paid', () => {
    expect(standing(row(true, SOON_DAYS + 1))).toBe('running')
  })

  it('turns to soon at the threshold and down to one day', () => {
    expect(standing(row(true, SOON_DAYS))).toBe('soon')
    expect(standing(row(true, 1))).toBe('soon')
  })

  it('is grace when the paid term is over but the pledge still counts', () => {
    expect(standing(row(true, 0))).toBe('grace')
  })

  it('is ended once the index no longer counts it, whatever daysLeft says', () => {
    expect(standing(row(false, 0))).toBe('ended')
  })
})

describe('reminder', () => {
  it('names the days left and the expiry date', () => {
    expect(reminder(row(true, 16), format)).toBe(`Ends in 16 days — ${format(EXPIRES)}`)
  })

  it('asks for a renewal within the threshold, singular on the last day', () => {
    expect(reminder(row(true, 1), format)).toBe(
      `Ends in 1 day — ${format(EXPIRES)}. Renew to keep it running.`,
    )
  })

  it('gives the end of the grace window, not the paid term, as the deadline in grace', () => {
    expect(reminder(row(true, 0), format)).toBe(
      `The paid term ended on ${format(EXPIRES)}. Renew before ${format(EXPIRES + GRACE_SECONDS)} to stay counted.`,
    )
  })

  it('states the end date of a lapsed pledge', () => {
    expect(reminder(row(false, 0), format)).toBe(`Ended on ${format(EXPIRES)}`)
  })
})

describe('splitPledges', () => {
  it('keeps the api order for running pledges and puts the latest ended first', () => {
    const a = row(true, 0, 'a-a-a')
    const b = row(true, 20, 'b-b-b')
    const old = {
      ...row(false, 0, 'old-old'),
      expiresAt: new Date((EXPIRES - 90 * DAY) * 1000).toISOString(),
    }
    const recent = {
      ...row(false, 0, 'recent'),
      expiresAt: new Date((EXPIRES - 10 * DAY) * 1000).toISOString(),
    }
    expect(splitPledges([old, recent, a, b])).toEqual({ current: [a, b], ended: [recent, old] })
  })

  it('returns two empty lists for a wallet with no pledges', () => {
    expect(splitPledges([])).toEqual({ current: [], ended: [] })
  })
})
