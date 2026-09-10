import { describe, expect, it } from 'vitest'
import {
  creatorContributionsSchema,
  creatorProfileSchema,
  creatorSupportersSchema,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  pageQuerySchema,
} from './creators.ts'

const CREATOR = '6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk'
const SUPPORTER = 'D4TkDq52FCqPyvwgQWBDepBumsYKB5ZjroRLfGckrYnQ'
const SIG =
  '5STQAx9AuBLwk4MCuox4p1M8s7qqJKtDo1N567sgwTWWoGZsTNVWYwZHaRF3JAechZM2c9BK1AVrppJncQya8BAg'
const CIPHERTEXT = Buffer.alloc(128, 7).toString('base64')

const profile = {
  wallet: CREATOR,
  handle: 'marrow-dispatch',
  name: 'Ilse Marrow',
  description: 'Independent reporting from the port cities.',
  suggestedAmount: '5000000',
  createdSlot: 498_814_836,
  activeSupporters: 128,
  totalSupporters: 128,
}

describe('pageQuerySchema', () => {
  it('defaults the limit and keeps the cursor opaque', () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: PAGE_LIMIT_DEFAULT })
    expect(pageQuerySchema.parse({ cursor: 'abc', limit: '7' })).toEqual({
      cursor: 'abc',
      limit: 7,
    })
  })

  it('rejects an empty cursor and a limit outside 1..max', () => {
    expect(pageQuerySchema.safeParse({ cursor: '' }).success).toBe(false)
    expect(pageQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
    expect(pageQuerySchema.safeParse({ limit: String(PAGE_LIMIT_MAX + 1) }).success).toBe(false)
    expect(pageQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false)
  })
})

describe('creatorProfileSchema', () => {
  it('accepts a profile with the two supporter counters', () => {
    expect(creatorProfileSchema.parse(profile)).toEqual(profile)
  })

  it('keeps suggestedAmount a decimal string: u64 does not fit a number', () => {
    expect(
      creatorProfileSchema.safeParse({ ...profile, suggestedAmount: '18446744073709551615' })
        .success,
    ).toBe(true)
    expect(creatorProfileSchema.safeParse({ ...profile, suggestedAmount: 5 }).success).toBe(false)
    expect(creatorProfileSchema.safeParse({ ...profile, suggestedAmount: '-1' }).success).toBe(
      false,
    )
  })

  it('rejects a malformed handle, wallet or a negative counter', () => {
    expect(creatorProfileSchema.safeParse({ ...profile, handle: 'Marrow' }).success).toBe(false)
    expect(creatorProfileSchema.safeParse({ ...profile, wallet: 'nope' }).success).toBe(false)
    expect(creatorProfileSchema.safeParse({ ...profile, activeSupporters: -1 }).success).toBe(false)
  })

  it('exposes exactly the public profile and the two counters', () => {
    expect(Object.keys(creatorProfileSchema.shape)).toEqual([
      'wallet',
      'handle',
      'name',
      'description',
      'suggestedAmount',
      'createdSlot',
      'activeSupporters',
      'totalSupporters',
    ])
  })
})

describe('creatorSupportersSchema', () => {
  const page = {
    count: 128,
    items: [
      {
        wallet: SUPPORTER,
        since: '2026-09-14T10:00:00.000Z',
        expiresAt: '2026-10-14T10:00:00.000Z',
      },
    ],
    nextCursor: null,
  }

  it('accepts a page of listed supporters with an overall count', () => {
    expect(creatorSupportersSchema.parse(page)).toEqual(page)
    expect(creatorSupportersSchema.parse({ ...page, nextCursor: 'abc' }).nextCursor).toBe('abc')
  })

  it('rejects a date that is not ISO-8601 with a zone', () => {
    const item = { ...page.items[0], since: '2026-09-14' }
    expect(creatorSupportersSchema.safeParse({ ...page, items: [item] }).success).toBe(false)
  })
})

describe('creatorContributionsSchema', () => {
  const item = {
    sig: SIG,
    supporter: SUPPORTER,
    slot: 498_814_836,
    blockTime: '2026-09-14T10:00:00.000Z',
    periods: 3,
    groupedLo: CIPHERTEXT,
    groupedHi: CIPHERTEXT,
  }

  it('accepts a page of contributions carrying the recipient ciphertext', () => {
    const page = { items: [item], nextCursor: 'abc' }
    expect(creatorContributionsSchema.parse(page)).toEqual(page)
  })

  it('rejects a ciphertext half that is not exactly 128 bytes of base64', () => {
    const short = Buffer.alloc(64).toString('base64')
    expect(
      creatorContributionsSchema.safeParse({
        items: [{ ...item, groupedLo: short }],
        nextCursor: null,
      }).success,
    ).toBe(false)
    expect(
      creatorContributionsSchema.safeParse({
        items: [{ ...item, groupedHi: 'not base64!' }],
        nextCursor: null,
      }).success,
    ).toBe(false)
  })

  it('rejects periods outside 1..12', () => {
    expect(
      creatorContributionsSchema.safeParse({ items: [{ ...item, periods: 0 }], nextCursor: null })
        .success,
    ).toBe(false)
    expect(
      creatorContributionsSchema.safeParse({ items: [{ ...item, periods: 13 }], nextCursor: null })
        .success,
    ).toBe(false)
  })
})
