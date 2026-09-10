import type { ContributionRow, CreatorsReader, SupporterRow } from '@ccsupport/db'
import { addressSchema, handleSchema, pageQuerySchema } from '@ccsupport/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { decodeCursor, encodeCursor } from '../cursor.ts'
import type { AppEnv } from '../env.ts'
import { fail } from '../middleware/errors.ts'

export type CreatorsDeps = {
  reader: CreatorsReader
  now?: () => Date
}

const handleParam = z.object({ handle: handleSchema })
const supporterCursor = z.tuple([z.iso.datetime(), addressSchema])
const contributionCursor = z.tuple([z.string().regex(/^\d+$/), z.string().min(1)])

const reasonOf = (issues: readonly z.core.$ZodIssue[]) =>
  issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')

const validateHandle = zValidator('param', handleParam, (result, c) => {
  if (!result.success) {
    return fail(c, 'INVALID_INPUT', 'invalid handle', { reason: reasonOf(result.error.issues) })
  }
})

const validateQuery = zValidator('query', pageQuerySchema, (result, c) => {
  if (!result.success) {
    return fail(c, 'INVALID_INPUT', 'invalid page query', { reason: reasonOf(result.error.issues) })
  }
})

// One row past the limit tells whether a next page exists without a count query.
function page<T>(rows: T[], limit: number, keyOf: (row: T) => readonly string[]) {
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  const nextCursor = rows.length > limit && last ? encodeCursor(keyOf(last)) : null
  return { items, nextCursor }
}

const supporterKey = (row: SupporterRow) => [row.startedAt.toISOString(), row.supporter]
const contributionKey = (row: ContributionRow) => [row.slot, row.sig]

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

export function creatorsRoute(deps: CreatorsDeps): Hono<AppEnv> {
  const now = deps.now ?? (() => new Date())

  return new Hono<AppEnv>()
    .get('/creators/:handle', validateHandle, async (c) => {
      const profile = await deps.reader.profile(c.req.valid('param').handle, now())
      if (!profile) return fail(c, 'NOT_FOUND', 'no creator with this handle')
      return c.json({ data: { ...profile, createdSlot: Number(profile.createdSlot) } })
    })
    .get('/creators/:handle/supporters', validateHandle, validateQuery, async (c) => {
      const { cursor, limit } = c.req.valid('query')
      const after = cursor === undefined ? null : decodeCursor(cursor, supporterCursor)
      if (cursor !== undefined && after === null) {
        return fail(c, 'INVALID_INPUT', 'invalid page query', {
          reason: 'cursor: not a supporters cursor',
        })
      }
      const at = now()
      const profile = await deps.reader.profile(c.req.valid('param').handle, at)
      if (!profile) return fail(c, 'NOT_FOUND', 'no creator with this handle')
      const rows = await deps.reader.supporters(
        profile.wallet,
        at,
        after && { startedAt: new Date(after[0]), supporter: after[1] },
        limit + 1,
      )
      const { items, nextCursor } = page(rows, limit, supporterKey)
      return c.json({
        data: {
          count: profile.activeSupporters,
          items: items.map((row) => ({
            wallet: row.supporter,
            since: row.startedAt.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
          })),
          nextCursor,
        },
      })
    })
    .get('/creators/:handle/contributions', validateHandle, validateQuery, async (c) => {
      const { cursor, limit } = c.req.valid('query')
      const after = cursor === undefined ? null : decodeCursor(cursor, contributionCursor)
      if (cursor !== undefined && after === null) {
        return fail(c, 'INVALID_INPUT', 'invalid page query', {
          reason: 'cursor: not a contributions cursor',
        })
      }
      const profile = await deps.reader.profile(c.req.valid('param').handle, now())
      if (!profile) return fail(c, 'NOT_FOUND', 'no creator with this handle')
      const rows = await deps.reader.contributions(
        profile.wallet,
        after && { slot: after[0], sig: after[1] },
        limit + 1,
      )
      const { items, nextCursor } = page(rows, limit, contributionKey)
      return c.json({
        data: {
          items: items.map((row) => ({
            sig: row.sig,
            supporter: row.supporter,
            slot: Number(row.slot),
            blockTime: row.blockTime.toISOString(),
            periods: row.periods,
            groupedLo: toBase64(row.groupedLo),
            groupedHi: toBase64(row.groupedHi),
          })),
          nextCursor,
        },
      })
    })
}
