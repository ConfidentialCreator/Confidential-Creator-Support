import { afterEach, describe, expect, it } from 'vitest'
import { createDb, type DbHandle } from '../client.ts'
import { monthlySeries, SERIES_MONTHS } from './series.ts'

// postgres.js opens no socket until the first query; `getQuery()` never sends one.
const URL = 'postgres://postgres.x:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
const CREATOR = '6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk'
const NOW = new Date('2026-09-15T10:00:00Z')

let handle: DbHandle | null = null
afterEach(async () => {
  await handle?.close()
  handle = null
})

const db = () => {
  handle = createDb(URL)
  return handle.db
}

const query = (now: Date, months?: number) => monthlySeries(db(), CREATOR, now, months).getQuery()

describe('monthlySeries', () => {
  it('counts the pledges of one creator per month, oldest month first', () => {
    const { sql, params } = query(NOW)
    expect(sql).toContain('generate_series(')
    expect(sql).toContain("to_char(m.month_start, 'YYYY-MM')")
    expect(sql).toContain('from "pledges" as p')
    expect(sql).toContain('p.creator = $')
    expect(sql).toContain('order by m.month_start asc')
    expect(params).toEqual([NOW.toISOString(), SERIES_MONTHS - 1, NOW.toISOString(), CREATOR])
  })

  it('counts a month a pledge lived through, not only one it ended in', () => {
    const { sql } = query(NOW)
    expect(sql).toContain("p.started_at < (m.month_start + interval '1 month') at time zone 'UTC'")
    expect(sql).toContain("ccs_is_active(p.expires_at, m.month_start at time zone 'UTC')")
  })

  it('buckets months in UTC, so every reader gets the same months', () => {
    const { sql } = query(NOW)
    expect(sql.match(/date_trunc\('month', \$\d+::timestamptz at time zone 'UTC'\)/g)).toHaveLength(
      2,
    )
  })

  it('takes a shorter window and answers a count, not a string', () => {
    const { sql, params } = query(NOW, 3)
    expect(params[1]).toBe(2)
    expect(sql).toContain('count(*)::int')
  })
})
