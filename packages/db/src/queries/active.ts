import { and, eq, type SQL, sql } from 'drizzle-orm'
import type { Db } from '../client.ts'
import { pledges } from '../schema.ts'

// A Date inside a raw fragment reaches postgres.js as an object: the postgres-js driver
// makes the timestamptz serializer transparent and only column-typed params go through
// drizzle's own Date → ISO mapping, so raw timestamps are passed as text.
export const asTimestamptz = (at: Date): SQL => sql`${at.toISOString()}::timestamptz`

// The grace window lives in `ccs_is_active` (migration 0002) — one definition for the
// whole index. `now` is a parameter, not `now()`: tests and the demo fix the clock.
export const activeAt = (expiresAt: SQL, now: Date): SQL =>
  sql`ccs_is_active(${expiresAt}, ${asTimestamptz(now)})`

export function pledgeStatus(db: Db, creator: string, supporter: string, now: Date) {
  return db
    .select({
      creator: pledges.creator,
      supporter: pledges.supporter,
      startedAt: pledges.startedAt,
      expiresAt: pledges.expiresAt,
      showPublicly: pledges.showPublicly,
      active: activeAt(sql`${pledges.expiresAt}`, now).mapWith(Boolean),
    })
    .from(pledges)
    .where(and(eq(pledges.creator, creator), eq(pledges.supporter, supporter)))
    .limit(1)
}

export type PledgeStatusRow = Awaited<ReturnType<typeof pledgeStatus>>[number]
