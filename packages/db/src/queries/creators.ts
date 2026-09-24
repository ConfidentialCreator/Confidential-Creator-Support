import { and, asc, desc, eq, type SQL, sql } from 'drizzle-orm'
import type { Db } from '../client.ts'
import { contributions, creators, pledges } from '../schema.ts'
import { activeAt, asTimestamptz } from './active.ts'

export type SupporterKey = { startedAt: Date; supporter: string }
export type ContributionKey = { slot: string; sig: string }

// Explicit alias: inside a one-table select drizzle strips table qualifiers from
// column references, and a correlated `"creator" = "wallet"` names no column of pledges.
const supportersOf = (predicate: SQL): SQL =>
  sql`(select count(*) from ${pledges} as p where p.creator = ${creators}.wallet and ${predicate})`

export function creatorByHandle(db: Db, handle: string, now: Date) {
  return db
    .select({
      wallet: creators.wallet,
      handle: creators.handle,
      name: creators.name,
      description: creators.description,
      suggestedAmount: creators.suggestedAmount,
      createdSlot: creators.createdSlot,
      activeSupporters: supportersOf(activeAt(sql.raw('p.expires_at'), now)).mapWith(Number),
      totalSupporters: supportersOf(sql`true`).mapWith(Number),
    })
    .from(creators)
    .where(eq(creators.handle, handle))
    .limit(1)
}

export type CreatorProfileRow = Awaited<ReturnType<typeof creatorByHandle>>[number]

// Keyset, not offset: a pledge that lands between two requests must not shift the page.
export function supportersPage(
  db: Db,
  creator: string,
  now: Date,
  after: SupporterKey | null,
  limit: number,
) {
  return db
    .select({
      supporter: pledges.supporter,
      startedAt: pledges.startedAt,
      expiresAt: pledges.expiresAt,
    })
    .from(pledges)
    .where(
      and(
        eq(pledges.creator, creator),
        eq(pledges.showPublicly, true),
        activeAt(sql`${pledges.expiresAt}`, now),
        after
          ? sql`(${pledges.startedAt}, ${pledges.supporter}) > (${asTimestamptz(after.startedAt)}, ${after.supporter})`
          : undefined,
      ),
    )
    .orderBy(asc(pledges.startedAt), asc(pledges.supporter))
    .limit(limit)
}

export type SupporterRow = Awaited<ReturnType<typeof supportersPage>>[number]

export function contributionsPage(
  db: Db,
  creator: string,
  after: ContributionKey | null,
  limit: number,
) {
  return db
    .select({
      sig: contributions.sig,
      supporter: contributions.supporter,
      slot: contributions.slot,
      blockTime: contributions.blockTime,
      periods: contributions.periods,
      groupedLo: contributions.groupedLo,
      groupedHi: contributions.groupedHi,
    })
    .from(contributions)
    .where(
      and(
        eq(contributions.creator, creator),
        after
          ? sql`(${contributions.slot}, ${contributions.sig}) < (${after.slot}::numeric, ${after.sig})`
          : undefined,
      ),
    )
    .orderBy(desc(contributions.slot), desc(contributions.sig))
    .limit(limit)
}

export type ContributionRow = Awaited<ReturnType<typeof contributionsPage>>[number]

export type CreatorsReader = {
  profile: (handle: string, now: Date) => Promise<CreatorProfileRow | undefined>
  supporters: (
    creator: string,
    now: Date,
    after: SupporterKey | null,
    limit: number,
  ) => Promise<SupporterRow[]>
  contributions: (
    creator: string,
    after: ContributionKey | null,
    limit: number,
  ) => Promise<ContributionRow[]>
}

export function drizzleCreatorsReader(db: Db): CreatorsReader {
  return {
    profile: async (handle, now) => (await creatorByHandle(db, handle, now))[0],
    supporters: (creator, now, after, limit) => supportersPage(db, creator, now, after, limit),
    contributions: (creator, after, limit) => contributionsPage(db, creator, after, limit),
  }
}
