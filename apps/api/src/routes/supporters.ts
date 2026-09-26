import type { SupportersReader } from '@ccsupport/db'
import { addressSchema, daysLeft } from '@ccsupport/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { fail } from '../middleware/errors.ts'

export type SupportersDeps = {
  reader: SupportersReader
  now?: () => Date
}

const walletParam = z.object({ wallet: addressSchema })

const validateWallet = zValidator('param', walletParam, (result, c) => {
  if (!result.success) {
    const reason = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    return fail(c, 'INVALID_INPUT', 'invalid wallet', { reason })
  }
})

const seconds = (at: Date) => Math.floor(at.getTime() / 1000)

export function supportersRoute(deps: SupportersDeps): Hono<AppEnv> {
  const now = deps.now ?? (() => new Date())

  // A wallet with no pledges is a valid answer, not a missing resource: any address can
  // open its cabinet before the first contribution.
  return new Hono<AppEnv>().get('/supporters/:wallet/pledges', validateWallet, async (c) => {
    const at = now()
    const rows = await deps.reader.pledges(c.req.valid('param').wallet, at)
    return c.json({
      data: rows.map((row) => ({
        creator: row.creator,
        handle: row.handle,
        name: row.name,
        expiresAt: row.expiresAt.toISOString(),
        active: row.active,
        daysLeft: daysLeft(seconds(at), seconds(row.expiresAt)),
        contributions: row.contributions,
      })),
    })
  })
}
