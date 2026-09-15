import { readFileSync } from 'node:fs'
import { createDb, type DbHandle } from '@ccsupport/db'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  contributionInsert,
  createApplier,
  creatorUpsert,
  type IndexWrite,
  type IndexWriter,
  type IndexWrites,
  planWrites,
  pledgeUpsert,
} from './apply.ts'
import type { ChainReader, RecipientCiphertext } from './ciphertext.ts'
import type { ProgramTransaction } from './cursor.ts'
import { parseEvents } from './events.ts'

const FIXTURE_DIR = new URL('../../../fixtures/logs/', import.meta.url)
const fixtureSchema = z.object({
  signature: z.string(),
  slot: z.string(),
  blockTime: z.string().nullable(),
  logMessages: z.array(z.string()),
  wire: z.string(),
  ciphertext: z
    .object({
      context: z.string(),
      signatures: z.array(z.string()),
      proof: z.object({ signature: z.string(), wire: z.string() }),
    })
    .optional(),
})
type Fixture = z.infer<typeof fixtureSchema>
const fixture = (name: string): Fixture =>
  fixtureSchema.parse(JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_DIR), 'utf8')))

const txOf = (f: Fixture, over: Partial<ProgramTransaction> = {}): ProgramTransaction => ({
  signature: f.signature,
  slot: BigInt(f.slot),
  blockTime: f.blockTime === null ? null : Number(f.blockTime),
  logs: f.logMessages,
  failed: false,
  ...over,
})

const CREATOR = '6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk'
const SUPPORTER_0 = 'FQqLH29wPz6vwGhe9MSxzEFZg7qfzrZkW2bKcY91GAZw'
const NOW = new Date('2026-09-15T12:00:00Z')

const ciphertextOf = (f: Fixture): RecipientCiphertext => ({
  groupedLo: Uint8Array.from({ length: 128 }, (_, i) => i),
  groupedHi: Uint8Array.from({ length: 128 }, (_, i) => 255 - i),
  proofSig: f.ciphertext?.proof.signature ?? '',
})

// Upserts keyed like the tables, so a second delivery leaves the same rows.
function memoryWriter() {
  const creators = new Map<string, unknown>()
  const pledges = new Map<string, unknown>()
  const contributions = new Map<string, unknown>()
  const transactions: IndexWrite['table'][][] = []
  const writer: IndexWriter = async (fn) => {
    const batch: IndexWrite['table'][] = []
    const writes: IndexWrites = {
      upsertCreator: (row) => {
        batch.push('creators')
        creators.set(row.wallet, row)
        return Promise.resolve()
      },
      upsertPledge: (row) => {
        batch.push('pledges')
        pledges.set(`${row.creator}/${row.supporter}`, row)
        return Promise.resolve()
      },
      insertContribution: (row) => {
        batch.push('contributions')
        if (!contributions.has(row.sig)) contributions.set(row.sig, row)
        return Promise.resolve()
      },
    }
    await fn(writes)
    transactions.push(batch)
  }
  return { writer, creators, pledges, contributions, transactions }
}

function chainOf(fixtures: Fixture[]): ChainReader & { calls: number } {
  const wires = new Map<string, string>()
  const histories = new Map<string, string[]>()
  for (const f of fixtures) {
    wires.set(f.signature, f.wire)
    if (f.ciphertext) {
      wires.set(f.ciphertext.proof.signature, f.ciphertext.proof.wire)
      histories.set(f.ciphertext.context, f.ciphertext.signatures)
    }
  }
  const reader = {
    calls: 0,
    wire: (signature: string) => {
      reader.calls += 1
      return Promise.resolve(wires.get(signature) ?? null)
    },
    signaturesFor: (address: string) => {
      reader.calls += 1
      return Promise.resolve(histories.get(address) ?? [])
    },
    blockTime: (signature: string) => {
      reader.calls += 1
      const time = fixtures.find((f) => f.signature === signature)?.blockTime ?? null
      return Promise.resolve(time === null ? null : Number(time))
    },
  }
  return reader
}

describe('planWrites', () => {
  it('turns CreatorRegistered into a creators row with the registration slot', () => {
    const f = fixture('register')
    const writes = planWrites(txOf(f), parseEvents(f.logMessages), null, NOW)
    expect(writes).toEqual([
      {
        table: 'creators',
        row: {
          wallet: CREATOR,
          handle: 'marrow-dispatch',
          name: 'The Marrow Dispatch',
          description: 'Independent reporting on municipal budgets and public procurement.',
          suggestedAmount: '0',
          createdSlot: f.slot,
          indexedAt: NOW,
        },
      },
    ])
  })

  it('turns CreatorUpdated into the same row shape with the new profile', () => {
    const f = fixture('update')
    const writes = planWrites(txOf(f), parseEvents(f.logMessages), null, NOW)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.row).toMatchObject({ wallet: CREATOR, suggestedAmount: '5000000' })
  })

  it('turns a first Pledged into a pledge snapshot and a contribution with the ciphertext', () => {
    const f = fixture('pledge-first')
    const ciphertext = ciphertextOf(f)
    const writes = planWrites(txOf(f), parseEvents(f.logMessages), ciphertext, NOW)
    const [event] = parseEvents(f.logMessages)
    if (event?.kind !== 'pledged') throw new Error('kind')
    expect(writes).toEqual([
      {
        table: 'pledges',
        row: {
          creator: CREATOR,
          supporter: SUPPORTER_0,
          startedAt: new Date(Number(event.data.startedAt) * 1000),
          expiresAt: new Date(Number(event.data.expiresAt) * 1000),
          periodsTotal: 1,
          contributions: 1,
          showPublicly: true,
          lastSig: f.signature,
          lastSlot: f.slot,
        },
      },
      {
        table: 'contributions',
        row: {
          sig: f.signature,
          creator: CREATOR,
          supporter: SUPPORTER_0,
          slot: f.slot,
          blockTime: new Date(Number(f.blockTime) * 1000),
          periods: 1,
          kind: 'first',
          groupedLo: ciphertext.groupedLo,
          groupedHi: ciphertext.groupedHi,
          proofSig: ciphertext.proofSig,
        },
      },
    ])
  })

  it('marks the second Pledged of a pair as a renewal', () => {
    const f = fixture('pledge-renewal')
    const writes = planWrites(txOf(f), parseEvents(f.logMessages), ciphertextOf(f), NOW)
    expect(writes[1]?.row).toMatchObject({ kind: 'renewal', periods: 12 })
    expect(writes[0]?.row).toMatchObject({ contributions: 2, periodsTotal: 13 })
  })

  it('refuses a Pledged without ciphertext or without block time', () => {
    const f = fixture('pledge-first')
    const events = parseEvents(f.logMessages)
    expect(() => planWrites(txOf(f), events, null, NOW)).toThrow(/ciphertext/)
    expect(() => planWrites(txOf(f, { blockTime: null }), events, ciphertextOf(f), NOW)).toThrow(
      /blockTime/,
    )
  })
})

describe('createApplier', () => {
  const first = fixture('pledge-first')
  const renewal = fixture('pledge-renewal')
  const register = fixture('register')

  it('writes creator, pledge and contribution in chain order, one transaction per tx', async () => {
    const memory = memoryWriter()
    const chain = chainOf([first, renewal])
    const apply = createApplier({ writer: memory.writer, chain, now: () => NOW })
    await apply(txOf(register))
    await apply(txOf(first))
    await apply(txOf(renewal))
    expect(memory.transactions).toEqual([
      ['creators'],
      ['pledges', 'contributions'],
      ['pledges', 'contributions'],
    ])
    expect(memory.creators.size).toBe(1)
    expect(memory.pledges.size).toBe(1)
    expect(memory.pledges.get(`${CREATOR}/${SUPPORTER_0}`)).toMatchObject({ contributions: 2 })
    expect(memory.contributions.size).toBe(2)
    expect(memory.contributions.get(first.signature)).toMatchObject({
      kind: 'first',
      proofSig: first.ciphertext?.proof.signature,
    })
  })

  it('delivering the same transaction twice leaves the rows unchanged', async () => {
    const memory = memoryWriter()
    const apply = createApplier({ writer: memory.writer, chain: chainOf([first]), now: () => NOW })
    await apply(txOf(first))
    await apply(txOf(first))
    expect(memory.pledges.size).toBe(1)
    expect(memory.contributions.size).toBe(1)
  })

  it('skips a failed transaction and one without events without touching chain or db', async () => {
    const memory = memoryWriter()
    const chain = chainOf([first])
    const apply = createApplier({ writer: memory.writer, chain, now: () => NOW })
    await apply(txOf(first, { failed: true }))
    await apply(txOf(first, { logs: ['Program log: nothing'] }))
    expect(chain.calls).toBe(0)
    expect(memory.transactions).toEqual([])
  })

  it('reads the block time from the chain when the subscription delivered none', async () => {
    const memory = memoryWriter()
    const chain = chainOf([first])
    const apply = createApplier({ writer: memory.writer, chain, now: () => NOW })
    await apply(txOf(first, { blockTime: null }))
    expect(memory.contributions.get(first.signature)).toMatchObject({
      blockTime: new Date(Number(first.blockTime) * 1000),
    })
  })

  it('does not ask the chain for a block time the transaction already carries', async () => {
    const memory = memoryWriter()
    const chain = chainOf([first])
    const apply = createApplier({ writer: memory.writer, chain, now: () => NOW })
    await apply(txOf(first))
    const withTime = chain.calls
    await apply(txOf(first, { blockTime: null }))
    expect(chain.calls).toBe(withTime * 2 + 1)
  })

  it('rejects when the proof transaction cannot be read, writing nothing', async () => {
    const memory = memoryWriter()
    const chain = chainOf([{ ...first, ciphertext: undefined }])
    const apply = createApplier({ writer: memory.writer, chain, now: () => NOW })
    await expect(apply(txOf(first))).rejects.toThrow()
    expect(memory.transactions).toEqual([])
  })
})

describe('drizzle statements', () => {
  // postgres.js opens no socket until the first query; `.toSQL()` never sends one.
  const URL = 'postgres://postgres.x:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
  let handle: DbHandle | null = null
  afterEach(async () => {
    await handle?.close()
    handle = null
  })

  it('creator upsert refreshes the profile but keeps the registration slot', () => {
    handle = createDb(URL)
    const f = fixture('register')
    const [write] = planWrites(txOf(f), parseEvents(f.logMessages), null, NOW)
    if (write?.table !== 'creators') throw new Error('table')
    const { sql } = creatorUpsert(handle.db, write.row).toSQL()
    const set = sql.slice(sql.indexOf('do update set'))
    expect(sql).toContain('on conflict ("wallet")')
    expect(set).toContain('"suggested_amount"')
    expect(set).toContain('"indexed_at"')
    expect(set).not.toContain('"created_slot"')
    expect(set).not.toContain('"handle"')
  })

  it('pledge upsert replaces the snapshot, contribution insert ignores a duplicate signature', () => {
    handle = createDb(URL)
    const f = fixture('pledge-first')
    const [pledge, contribution] = planWrites(
      txOf(f),
      parseEvents(f.logMessages),
      ciphertextOf(f),
      NOW,
    )
    if (pledge?.table !== 'pledges' || contribution?.table !== 'contributions') {
      throw new Error('table')
    }
    const pledgeSql = pledgeUpsert(handle.db, pledge.row).toSQL().sql
    expect(pledgeSql).toContain('on conflict ("creator","supporter") do update set')
    expect(pledgeSql.slice(pledgeSql.indexOf('do update set'))).toContain('"expires_at"')
    const contributionSql = contributionInsert(handle.db, contribution.row).toSQL()
    expect(contributionSql.sql).toContain('on conflict ("sig") do nothing')
    expect(contributionSql.params).toContain(contribution.row.proofSig)
  })
})
