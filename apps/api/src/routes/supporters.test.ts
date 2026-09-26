import type { SupporterPledgeRow, SupportersReader } from '@ccsupport/db'
import { apiErrorBodySchema, GRACE_SECONDS, supporterPledgesSchema } from '@ccsupport/shared'
import { Hono } from 'hono'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { requestLogger } from '../logger.ts'
import { errorHandler } from '../middleware/errors.ts'
import { supportersRoute } from './supporters.ts'

const SUPPORTER = 'D4TkDq52FCqPyvwgQWBDepBumsYKB5ZjroRLfGckrYnQ'
const CREATOR_A = '6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk'
const CREATOR_B = 'FQqLH29wPz6vwGhe9MSxzEFZg7qfzrZkW2bKcY91GAZw'
const NOW = new Date('2026-09-15T10:00:00Z')
const DAY = 24 * 60 * 60 * 1000

const rowOf = (creator: string, handle: string, expiresInMs: number): SupporterPledgeRow => {
  const expiresAt = new Date(NOW.getTime() + expiresInMs)
  return {
    creator,
    handle,
    name: `Name of ${handle}`,
    expiresAt,
    active: expiresAt.getTime() + GRACE_SECONDS * 1000 > NOW.getTime(),
    contributions: 2,
  }
}

function build(rows: SupporterPledgeRow[]) {
  const calls: string[] = []
  const reader: SupportersReader = {
    pledges: async (supporter, now) => {
      calls.push(`pledges:${supporter}:${now.toISOString()}`)
      return supporter === SUPPORTER ? rows : []
    },
  }
  const app = new Hono<AppEnv>()
    .use('*', requestLogger(pino({ level: 'silent' })))
    .onError(errorHandler)
    .route('/', supportersRoute({ reader, now: () => NOW }))
  return { get: (path: string) => app.request(path), calls }
}

const dataOf = async (res: Response) =>
  z.object({ data: supporterPledgesSchema }).parse(await res.json()).data

describe('GET /supporters/:wallet/pledges', () => {
  it('lists every pledge of the wallet with the days left of the paid term', async () => {
    const { get, calls } = build([
      rowOf(CREATOR_A, 'marrow-dispatch', 2 * DAY + 1000),
      rowOf(CREATOR_B, 'port-ledger', 29 * DAY),
    ])
    const res = await get(`/supporters/${SUPPORTER}/pledges`)
    expect(res.status).toBe(200)
    expect(await dataOf(res)).toEqual([
      {
        creator: CREATOR_A,
        handle: 'marrow-dispatch',
        name: 'Name of marrow-dispatch',
        expiresAt: new Date(NOW.getTime() + 2 * DAY + 1000).toISOString(),
        active: true,
        daysLeft: 3,
        contributions: 2,
      },
      {
        creator: CREATOR_B,
        handle: 'port-ledger',
        name: 'Name of port-ledger',
        expiresAt: new Date(NOW.getTime() + 29 * DAY).toISOString(),
        active: true,
        daysLeft: 29,
        contributions: 2,
      },
    ])
    expect(calls).toEqual([`pledges:${SUPPORTER}:${NOW.toISOString()}`])
  })

  it('keeps a pledge in grace active with 0 days left, and a lapsed one inactive', async () => {
    const { get } = build([
      rowOf(CREATOR_A, 'marrow-dispatch', -1 * DAY),
      rowOf(CREATOR_B, 'port-ledger', -40 * DAY),
    ])
    const data = await dataOf(await get(`/supporters/${SUPPORTER}/pledges`))
    expect(data.map(({ active, daysLeft }) => ({ active, daysLeft }))).toEqual([
      { active: true, daysLeft: 0 },
      { active: false, daysLeft: 0 },
    ])
  })

  it('answers an empty list, not 404, for a wallet that never pledged', async () => {
    const { get } = build([])
    const res = await get(`/supporters/${CREATOR_A}/pledges`)
    expect(res.status).toBe(200)
    expect(await dataOf(res)).toEqual([])
  })

  it('is 400 INVALID_INPUT for a wallet that is not an address, before any lookup', async () => {
    const { get, calls } = build([])
    for (const wallet of ['nope', '0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl', 'a'.repeat(45)]) {
      const res = await get(`/supporters/${wallet}/pledges`)
      expect(res.status).toBe(400)
      expect(apiErrorBodySchema.parse(await res.json()).error.code).toBe('INVALID_INPUT')
    }
    expect(calls).toEqual([])
  })
})
