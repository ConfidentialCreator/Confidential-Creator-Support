import { sql } from 'drizzle-orm'
import type { Db } from '../client.ts'
import { pledges } from '../schema.ts'
import { asTimestamptz } from './active.ts'

export const SERIES_MONTHS = 12

export type SeriesRow = { month: string; active: number }

// Months are cut in UTC: `date_trunc` on a timestamptz follows the session time zone,
// and the index owes every reader the same months.
const monthOf = (now: Date) => sql`date_trunc('month', ${asTimestamptz(now)} at time zone 'UTC')`

// A supporter counts for every month the pledge lived through, not only the one it
// ended in — a month with a pledge that started and lapsed inside it is not empty.
export function monthlySeries(db: Db, creator: string, now: Date, months = SERIES_MONTHS) {
  return db.execute<SeriesRow>(sql`
    with months as (
      select generate_series(
        ${monthOf(now)} - make_interval(months => ${months - 1}),
        ${monthOf(now)},
        interval '1 month'
      ) as month_start
    )
    select
      to_char(m.month_start, 'YYYY-MM') as month,
      (
        select count(*)::int from ${pledges} as p
        where p.creator = ${creator}
          and p.started_at < (m.month_start + interval '1 month') at time zone 'UTC'
          and ccs_is_active(p.expires_at, m.month_start at time zone 'UTC')
      ) as active
    from months as m
    order by m.month_start asc
  `)
}
