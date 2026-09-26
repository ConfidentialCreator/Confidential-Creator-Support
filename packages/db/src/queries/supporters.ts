import { asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../client.ts'
import { creators, pledges } from '../schema.ts'
import { activeAt } from './active.ts'

// Hidden pledges are listed too: the wallet asking is the one that chose to hide them.
export function supporterPledges(db: Db, supporter: string, now: Date) {
  return db
    .select({
      creator: pledges.creator,
      handle: creators.handle,
      name: creators.name,
      expiresAt: pledges.expiresAt,
      active: activeAt(sql`${pledges.expiresAt}`, now).mapWith(Boolean),
      contributions: pledges.contributions,
    })
    .from(pledges)
    .innerJoin(creators, eq(creators.wallet, pledges.creator))
    .where(eq(pledges.supporter, supporter))
    .orderBy(asc(pledges.expiresAt), asc(pledges.creator))
}

export type SupporterPledgeRow = Awaited<ReturnType<typeof supporterPledges>>[number]

export type SupportersReader = {
  pledges: (supporter: string, now: Date) => Promise<SupporterPledgeRow[]>
}

export function drizzleSupportersReader(db: Db): SupportersReader {
  return { pledges: (supporter, now) => supporterPledges(db, supporter, now) }
}
