import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GRACE_SECONDS, PERIOD_SECONDS } from '@ccsupport/shared'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type DbHandle } from '../client.ts'
import { pledgeStatus } from './active.ts'
import { creatorByHandle } from './creators.ts'
import { supporterPledges } from './supporters.ts'

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

// The queries above only ever reach postgres as text, so the grace window is proven on a
// real engine: the migrations from the repo, then the exact SQL and params the
// postgres-js driver would send. PGlite is not Supabase — the planner may differ, the
// arithmetic of `timestamptz + interval` does not.
describe('the grace window on postgres', () => {
  const HANDLE = 'marrow-dispatch'
  const EXPIRES = new Date('2026-10-15T14:41:20Z')
  const EDGE = new Date(EXPIRES.getTime() + GRACE_SECONDS * 1000)
  const second = (at: Date, delta: number) => new Date(at.getTime() + delta * 1000)
  let pg: PGlite

  const rows = async (query: { toSQL: () => { sql: string; params: unknown[] } }) => {
    const { sql, params } = query.toSQL()
    return (await pg.query<unknown[]>(sql, params, { rowMode: 'array' })).rows
  }
  const statusAt = async (now: Date) =>
    (await rows(pledgeStatus(db(), CREATOR, SUPPORTER, now)))[0]?.[5]
  const countAt = async (now: Date) =>
    Number((await rows(creatorByHandle(db(), HANDLE, now)))[0]?.[6])
  const listedAt = async (now: Date) => (await rows(supporterPledges(db(), SUPPORTER, now)))[0]?.[4]

  beforeAll(async () => {
    pg = await PGlite.create()
    const dir = join(fileURLToPath(import.meta.url), '../../../migrations')
    for (const file of readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      await pg.exec(readFileSync(join(dir, file), 'utf8'))
    }
    await pg.query(
      `insert into creators values ($1, $2, 'The Marrow Dispatch', '', 5000000, 498814836, now())`,
      [CREATOR, HANDLE],
    )
    await pg.query(`insert into pledges values ($1, $2, $3, $4, 1, 1, true, 'sig', 500000000)`, [
      CREATOR,
      SUPPORTER,
      second(EXPIRES, -PERIOD_SECONDS).toISOString(),
      EXPIRES.toISOString(),
    ])
  })

  afterAll(async () => {
    await pg?.close()
  })

  it('keeps a supporter active up to the last second of grace and drops them at its end', async () => {
    expect(await statusAt(second(EDGE, -1))).toBe(true)
    expect(await statusAt(EDGE)).toBe(false)
    expect(await countAt(second(EDGE, -1))).toBe(1)
    expect(await countAt(EDGE)).toBe(0)
    expect(await listedAt(second(EDGE, -1))).toBe(true)
    expect(await listedAt(EDGE)).toBe(false)
  })

  it('counts grace from the expiry, not from the start of the period', async () => {
    expect(await statusAt(second(EXPIRES, 1))).toBe(true)
    expect(await countAt(second(EXPIRES, GRACE_SECONDS - 1))).toBe(1)
  })

  it('does not move the edge with the session time zone', async () => {
    await pg.exec(`set time zone 'Pacific/Kiritimati'`)
    try {
      expect(await statusAt(second(EDGE, -1))).toBe(true)
      expect(await statusAt(EDGE)).toBe(false)
    } finally {
      await pg.exec(`set time zone 'UTC'`)
    }
  })

  it('leaves no inactive second when a renewal moves the expiry before the old edge', async () => {
    const renewed = second(EXPIRES, PERIOD_SECONDS)
    await pg.query('update pledges set expires_at = $1 where supporter = $2', [
      renewed.toISOString(),
      SUPPORTER,
    ])
    try {
      expect(await statusAt(EDGE)).toBe(true)
      expect(await countAt(second(EDGE, PERIOD_SECONDS - 1))).toBe(1)
      expect(await countAt(second(EDGE, PERIOD_SECONDS))).toBe(0)
    } finally {
      await pg.query('update pledges set expires_at = $1 where supporter = $2', [
        EXPIRES.toISOString(),
        SUPPORTER,
      ])
    }
  })

  it('reports an unknown supporter as absent, not as inactive', async () => {
    const { sql, params } = pledgeStatus(db(), CREATOR, CREATOR, EDGE).toSQL()
    expect((await pg.query(sql, params)).rows).toEqual([])
  })
})
