import { afterEach, describe, expect, it } from 'vitest'
import { createDb, type DbHandle } from '../client.ts'
import { contributionsPage, creatorByHandle, supportersPage } from './creators.ts'

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

describe('creatorByHandle', () => {
  it('counts active supporters with the shared grace, total supporters without it', () => {
    const { sql, params } = creatorByHandle(db(), 'marrow-dispatch', NOW).toSQL()
    expect(sql).toContain('where "creators"."handle" = $')
    expect(sql).toContain('limit $')
    expect(
      sql.match(/select count\(\*\) from "pledges" as p where p\.creator = "creators"\.wallet/g),
    ).toHaveLength(2)
    expect(sql.match(/ccs_is_active\(p\.expires_at, \$\d+::timestamptz\)/g)).toHaveLength(1)
    expect(params).toEqual([NOW.toISOString(), 'marrow-dispatch', 1])
  })

  it('selects only the public profile columns', () => {
    const { sql } = creatorByHandle(db(), 'marrow-dispatch', NOW).toSQL()
    const projection = sql.slice(0, sql.indexOf(' from "creators"'))
    for (const column of [
      'wallet',
      'handle',
      'name',
      'description',
      'suggested_amount',
      'created_slot',
    ]) {
      expect(projection).toContain(`"${column}"`)
    }
    expect(projection).not.toContain('"indexed_at"')
  })
})

describe('supportersPage', () => {
  it('lists only public, active pledges oldest first', () => {
    const { sql, params } = supportersPage(db(), CREATOR, NOW, null, 51).toSQL()
    expect(sql).toContain('"pledges"."creator" = $')
    expect(sql).toContain('"pledges"."show_publicly" = $')
    expect(sql).toContain('ccs_is_active("pledges"."expires_at", $')
    expect(sql).toContain('order by "pledges"."started_at" asc, "pledges"."supporter" asc')
    expect(sql).not.toContain('(("pledges"."started_at", "pledges"."supporter") >')
    expect(params).toEqual([CREATOR, true, NOW.toISOString(), 51])
  })

  it('continues after the keyset of the last listed supporter', () => {
    const after = { startedAt: new Date('2026-09-01T00:00:00Z'), supporter: SUPPORTER }
    const { sql, params } = supportersPage(db(), CREATOR, NOW, after, 10).toSQL()
    expect(sql).toContain('("pledges"."started_at", "pledges"."supporter") > ($4::timestamptz, $5)')
    expect(params).toEqual([
      CREATOR,
      true,
      NOW.toISOString(),
      after.startedAt.toISOString(),
      SUPPORTER,
      10,
    ])
  })
})

describe('contributionsPage', () => {
  it('lists the creator contributions newest first with both ciphertext halves', () => {
    const { sql, params } = contributionsPage(db(), CREATOR, null, 51).toSQL()
    expect(sql).toContain('"contributions"."creator" = $')
    expect(sql).toContain('order by "contributions"."slot" desc, "contributions"."sig" desc')
    expect(sql).toContain('"grouped_lo", "grouped_hi" from "contributions"')
    expect(sql).not.toContain('"proof_sig"')
    expect(params).toEqual([CREATOR, 51])
  })

  it('continues below the keyset of the last contribution', () => {
    const after = { slot: '498814836', sig: '5STQ' }
    const { sql, params } = contributionsPage(db(), CREATOR, after, 10).toSQL()
    expect(sql).toContain('("contributions"."slot", "contributions"."sig") < ($2::numeric, $3)')
    expect(params).toEqual([CREATOR, '498814836', '5STQ', 10])
  })
})
