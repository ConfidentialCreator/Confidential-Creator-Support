import type { ContributionRow, CreatorsReader, SupporterRow } from '@ccsupport/db'
import {
  apiErrorBodySchema,
  creatorContributionsSchema,
  creatorProfileSchema,
  creatorSupportersSchema,
  GRACE_SECONDS,
  PAGE_LIMIT_DEFAULT,
} from '@ccsupport/shared'
import { address, getBase58Decoder } from '@solana/kit'
import { Hono } from 'hono'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { requestLogger } from '../logger.ts'
import { errorHandler } from '../middleware/errors.ts'
import { creatorsRoute } from './creators.ts'

const CREATOR = address('6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk')
const HANDLE = 'marrow-dispatch'
const NOW = new Date('2026-09-15T10:00:00Z')
const DAY = 24 * 60 * 60 * 1000

const supporterAt = (i: number) =>
  getBase58Decoder().decode(new Uint8Array(32).fill(i + 1)) as string
const sigAt = (i: number) => getBase58Decoder().decode(new Uint8Array(64).fill(i + 1))

type Pledge = SupporterRow & { showPublicly: boolean }

// Wallet i started i days ago and expires in (10 - i) days: 0..9 still run, 10..12
// are in grace, 13+ are gone. Odd wallets hide themselves.
const pledgeAt = (i: number): Pledge => ({
  supporter: supporterAt(i),
  startedAt: new Date(NOW.getTime() - i * DAY),
  expiresAt: new Date(NOW.getTime() + (10 - i) * DAY),
  showPublicly: i % 2 === 0,
})

const contributionAt = (i: number): ContributionRow => ({
  sig: sigAt(i),
  supporter: supporterAt(i % 4),
  slot: String(498_000_000 + i),
  blockTime: new Date(NOW.getTime() - i * DAY),
  periods: (i % 12) + 1,
  groupedLo: new Uint8Array(128).fill(i),
  groupedHi: new Uint8Array(128).fill(255 - i),
})

const isActive = (p: Pledge) => p.expiresAt.getTime() + GRACE_SECONDS * 1000 > NOW.getTime()

function build(pledges: Pledge[], contributions: ContributionRow[]) {
  const calls: string[] = []
  const reader: CreatorsReader = {
    profile: async (handle, now) => {
      calls.push(`profile:${handle}:${now.toISOString()}`)
      if (handle !== HANDLE) return undefined
      return {
        wallet: CREATOR,
        handle,
        name: 'Ilse Marrow',
        description: 'Independent reporting from the port cities.',
        suggestedAmount: '5000000',
        createdSlot: '498814836',
        activeSupporters: pledges.filter(isActive).length,
        totalSupporters: pledges.length,
      }
    },
    supporters: async (creator, _now, after, limit) => {
      calls.push(`supporters:${creator}:${after?.supporter ?? '-'}:${limit}`)
      return pledges
        .filter((p) => p.showPublicly && isActive(p))
        .filter(
          (p) =>
            after === null ||
            p.startedAt > after.startedAt ||
            (p.startedAt.getTime() === after.startedAt.getTime() && p.supporter > after.supporter),
        )
        .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
        .slice(0, limit)
        .map(({ supporter, startedAt, expiresAt }) => ({ supporter, startedAt, expiresAt }))
    },
    contributions: async (creator, after, limit) => {
      calls.push(`contributions:${creator}:${after?.sig ?? '-'}:${limit}`)
      return contributions
        .filter((c) => after === null || BigInt(c.slot) < BigInt(after.slot))
        .sort((a, b) => Number(BigInt(b.slot) - BigInt(a.slot)))
        .slice(0, limit)
    },
  }
  const app = new Hono<AppEnv>()
    .use('*', requestLogger(pino({ level: 'silent' })))
    .onError(errorHandler)
    .route('/', creatorsRoute({ reader, now: () => NOW }))
  return { get: (path: string) => app.request(path), calls }
}

const errorOf = async (res: Response) => apiErrorBodySchema.parse(await res.json()).error

describe('GET /creators/:handle', () => {
  it('answers with the profile and both supporter counters at the injected clock', async () => {
    const { get, calls } = build([0, 5, 11, 20].map(pledgeAt), [])
    const res = await get(`/creators/${HANDLE}`)
    expect(res.status).toBe(200)
    const data = z.object({ data: creatorProfileSchema }).parse(await res.json()).data
    expect(data).toEqual({
      wallet: CREATOR,
      handle: HANDLE,
      name: 'Ilse Marrow',
      description: 'Independent reporting from the port cities.',
      suggestedAmount: '5000000',
      createdSlot: 498_814_836,
      activeSupporters: 3,
      totalSupporters: 4,
    })
    expect(calls).toEqual([`profile:${HANDLE}:${NOW.toISOString()}`])
  })

  it('is 404 NOT_FOUND for a handle nobody registered', async () => {
    const { get } = build([], [])
    const res = await get('/creators/nobody-here')
    expect(res.status).toBe(404)
    expect((await errorOf(res)).code).toBe('NOT_FOUND')
  })

  it('is 400 INVALID_INPUT for a handle outside the pattern, before any lookup', async () => {
    const { get, calls } = build([], [])
    for (const handle of ['Marrow', 'ab', 'a'.repeat(33), 'with_underscore']) {
      const res = await get(`/creators/${handle}`)
      expect(res.status).toBe(400)
      expect((await errorOf(res)).code).toBe('INVALID_INPUT')
    }
    expect(calls).toEqual([])
  })
})

describe('GET /creators/:handle/supporters', () => {
  const pledges = Array.from({ length: 16 }, (_, i) => pledgeAt(i))
  const dataOf = async (res: Response) =>
    z.object({ data: creatorSupportersSchema }).parse(await res.json()).data

  it('lists public active supporters oldest first, counts every active one', async () => {
    const { get, calls } = build(pledges, [])
    const res = await get(`/creators/${HANDLE}/supporters`)
    expect(res.status).toBe(200)
    const data = await dataOf(res)
    // 0..12 active (13 wallets), even ones listed: 0 2 4 6 8 10 12.
    expect(data.count).toBe(13)
    expect(data.items.map((s) => s.wallet)).toEqual([12, 10, 8, 6, 4, 2, 0].map(supporterAt))
    expect(data.items[0]).toEqual({
      wallet: supporterAt(12),
      since: new Date(NOW.getTime() - 12 * DAY).toISOString(),
      expiresAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
    })
    expect(data.nextCursor).toBeNull()
    expect(calls[1]).toBe(`supporters:${CREATOR}:-:${PAGE_LIMIT_DEFAULT + 1}`)
  })

  it('pages with an opaque cursor and stops when the page is short', async () => {
    const { get } = build(pledges, [])
    const first = await dataOf(await get(`/creators/${HANDLE}/supporters?limit=3`))
    expect(first.items.map((s) => s.wallet)).toEqual([12, 10, 8].map(supporterAt))
    expect(first.nextCursor).not.toBeNull()

    const second = await dataOf(
      await get(`/creators/${HANDLE}/supporters?limit=3&cursor=${first.nextCursor}`),
    )
    expect(second.items.map((s) => s.wallet)).toEqual([6, 4, 2].map(supporterAt))
    expect(second.count).toBe(13)

    const third = await dataOf(
      await get(`/creators/${HANDLE}/supporters?limit=3&cursor=${second.nextCursor}`),
    )
    expect(third.items.map((s) => s.wallet)).toEqual([0].map(supporterAt))
    expect(third.nextCursor).toBeNull()
  })

  it('rejects a cursor it did not mint and a limit outside the range', async () => {
    const { get } = build(pledges, [])
    for (const query of ['cursor=garbage', 'cursor=', 'limit=0', 'limit=101', 'limit=abc']) {
      const res = await get(`/creators/${HANDLE}/supporters?${query}`)
      expect(res.status).toBe(400)
      expect((await errorOf(res)).code).toBe('INVALID_INPUT')
    }
    const contributionsCursor = (
      await z
        .object({ data: creatorContributionsSchema })
        .parse(
          await (
            await build([], [contributionAt(0), contributionAt(1)]).get(
              `/creators/${HANDLE}/contributions?limit=1`,
            )
          ).json(),
        )
    ).data.nextCursor
    const res = await get(`/creators/${HANDLE}/supporters?cursor=${contributionsCursor}`)
    expect(res.status).toBe(400)
  })

  it('is 404 for an unknown handle', async () => {
    const { get } = build(pledges, [])
    expect((await get('/creators/nobody-here/supporters')).status).toBe(404)
  })
})

describe('GET /creators/:handle/contributions', () => {
  const contributions = Array.from({ length: 5 }, (_, i) => contributionAt(i))
  const dataOf = async (res: Response) =>
    z.object({ data: creatorContributionsSchema }).parse(await res.json()).data

  it('lists contributions newest first with the ciphertext halves in base64', async () => {
    const { get } = build([], contributions)
    const res = await get(`/creators/${HANDLE}/contributions`)
    expect(res.status).toBe(200)
    const data = await dataOf(res)
    expect(data.items.map((c) => c.sig)).toEqual([4, 3, 2, 1, 0].map(sigAt))
    expect(data.items[0]).toEqual({
      sig: sigAt(4),
      supporter: supporterAt(0),
      slot: 498_000_004,
      blockTime: new Date(NOW.getTime() - 4 * DAY).toISOString(),
      periods: 5,
      groupedLo: Buffer.alloc(128, 4).toString('base64'),
      groupedHi: Buffer.alloc(128, 251).toString('base64'),
    })
    expect(data.nextCursor).toBeNull()
    expect(JSON.stringify(data)).not.toMatch(/proof/i)
  })

  it('pages by slot and signature through the cursor', async () => {
    const { get, calls } = build([], contributions)
    const first = await dataOf(await get(`/creators/${HANDLE}/contributions?limit=2`))
    expect(first.items.map((c) => c.slot)).toEqual([498_000_004, 498_000_003])
    const second = await dataOf(
      await get(`/creators/${HANDLE}/contributions?limit=2&cursor=${first.nextCursor}`),
    )
    expect(second.items.map((c) => c.slot)).toEqual([498_000_002, 498_000_001])
    expect(calls.at(-1)).toBe(`contributions:${CREATOR}:${sigAt(3)}:3`)
    const third = await dataOf(
      await get(`/creators/${HANDLE}/contributions?limit=2&cursor=${second.nextCursor}`),
    )
    expect(third.items.map((c) => c.slot)).toEqual([498_000_000])
    expect(third.nextCursor).toBeNull()
  })

  it('is 404 for an unknown handle and 400 for a foreign cursor', async () => {
    const { get } = build([], contributions)
    expect((await get('/creators/nobody-here/contributions')).status).toBe(404)
    const res = await get(
      `/creators/${HANDLE}/contributions?cursor=${Buffer.from('["x"]').toString('base64url')}`,
    )
    expect(res.status).toBe(400)
    expect((await errorOf(res)).details?.reason).toContain('cursor')
  })
})
