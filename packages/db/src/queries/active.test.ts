import { afterEach, describe, expect, it } from 'vitest'
import { createDb, type DbHandle } from '../client.ts'
import { pledgeStatus } from './active.ts'

// postgres.js opens no socket until the first query; `.toSQL()` never sends one.
const URL = 'postgres://postgres.x:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
const CREATOR = '6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk'
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

describe('pledgeStatus', () => {
  it('asks the grace window of the index, with the clock as a parameter', () => {
    const { sql, params } = pledgeStatus(db(), CREATOR, SUPPORTER, NOW).toSQL()
    expect(sql).toContain('ccs_is_active("pledges"."expires_at", $1::timestamptz)')
    expect(sql).toContain('"pledges"."creator" = $')
    expect(sql).toContain('"pledges"."supporter" = $')
    expect(params).toEqual([NOW.toISOString(), CREATOR, SUPPORTER, 1])
  })

  it('answers a moved clock without touching the row', () => {
    const later = new Date('2026-10-20T00:00:00Z')
    const { params } = pledgeStatus(db(), CREATOR, SUPPORTER, later).toSQL()
    expect(params[0]).toBe(later.toISOString())
  })

  it('selects the dates and the flag, never a ciphertext', () => {
    const { sql } = pledgeStatus(db(), CREATOR, SUPPORTER, NOW).toSQL()
    const projection = sql.slice(0, sql.indexOf(' from "pledges"'))
    expect(projection).toContain('"expires_at"')
    expect(projection).toContain('"started_at"')
    expect(projection).not.toContain('grouped')
  })
})
