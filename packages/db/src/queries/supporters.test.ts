import { afterEach, describe, expect, it } from 'vitest'
import { createDb, type DbHandle } from '../client.ts'
import { supporterPledges } from './supporters.ts'

// postgres.js opens no socket until the first query; `.toSQL()` never sends one.
const URL = 'postgres://postgres.x:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
const SUPPORTER = 'D4TkDq52FCqPyvwgQWBDepBumsYKB5ZjroRLfGckrYnQ'
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

describe('supporterPledges', () => {
  it('filters by the supporter only and asks the index grace window at the given clock', () => {
    const { sql, params } = supporterPledges(db(), SUPPORTER, NOW).toSQL()
    expect(sql).toContain('ccs_is_active("pledges"."expires_at", $1::timestamptz)')
    expect(sql).toContain('where "pledges"."supporter" = $2')
    expect(sql).not.toContain('"show_publicly"')
    expect(params).toEqual([NOW.toISOString(), SUPPORTER])
  })

  it('takes handle and name from the creator of each pledge', () => {
    const { sql } = supporterPledges(db(), SUPPORTER, NOW).toSQL()
    expect(sql).toContain('inner join "creators" on "creators"."wallet" = "pledges"."creator"')
    expect(sql).toContain('"creators"."handle"')
    expect(sql).toContain('"creators"."name"')
  })

  it('puts the soonest expiry first, the creator breaking a tie', () => {
    const { sql } = supporterPledges(db(), SUPPORTER, NOW).toSQL()
    expect(sql).toMatch(/order by "pledges"\."expires_at" asc, "pledges"\."creator" asc$/)
  })

  it('selects no ciphertext', () => {
    const { sql } = supporterPledges(db(), SUPPORTER, NOW).toSQL()
    const projection = sql.slice(0, sql.indexOf(' from "pledges"'))
    expect(projection).not.toContain('grouped')
  })
})
