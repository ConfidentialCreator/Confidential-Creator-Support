import { describe, expect, it } from 'vitest'
import { supporterPledgesSchema } from './supporters.ts'

const CREATOR = '6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk'

const pledge = {
  creator: CREATOR,
  handle: 'marrow-dispatch',
  name: 'Ilse Marrow',
  expiresAt: '2026-10-14T10:00:00.000Z',
  active: true,
  daysLeft: 29,
  contributions: 2,
}

describe('supporterPledgesSchema', () => {
  it('accepts the list of a wallet pledges, and an empty one for a wallet with none', () => {
    expect(supporterPledgesSchema.parse([pledge])).toEqual([pledge])
    expect(supporterPledgesSchema.parse([])).toEqual([])
  })

  it('accepts a lapsed pledge: history stays after the grace window', () => {
    const lapsed = { ...pledge, active: false, daysLeft: 0 }
    expect(supporterPledgesSchema.parse([lapsed])).toEqual([lapsed])
  })

  it('rejects a negative or fractional daysLeft and a pledge with no contribution', () => {
    expect(supporterPledgesSchema.safeParse([{ ...pledge, daysLeft: -1 }]).success).toBe(false)
    expect(supporterPledgesSchema.safeParse([{ ...pledge, daysLeft: 1.5 }]).success).toBe(false)
    expect(supporterPledgesSchema.safeParse([{ ...pledge, contributions: 0 }]).success).toBe(false)
  })

  it('rejects a malformed creator, handle or expiry', () => {
    expect(supporterPledgesSchema.safeParse([{ ...pledge, creator: 'nope' }]).success).toBe(false)
    expect(supporterPledgesSchema.safeParse([{ ...pledge, handle: 'Marrow' }]).success).toBe(false)
    expect(supporterPledgesSchema.safeParse([{ ...pledge, expiresAt: '2026-10-14' }]).success).toBe(
      false,
    )
  })

  it('exposes dates, counters and the flag — no field that could hold a sum', () => {
    expect(Object.keys(supporterPledgesSchema.element.shape)).toEqual([
      'creator',
      'handle',
      'name',
      'expiresAt',
      'active',
      'daysLeft',
      'contributions',
    ])
  })
})
