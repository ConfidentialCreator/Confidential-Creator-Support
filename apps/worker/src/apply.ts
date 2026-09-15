import { type Db, schema } from '@ccsupport/db'
import {
  type ChainReader,
  fetchRecipientCiphertext,
  type RecipientCiphertext,
} from './ciphertext.ts'
import type { ProgramTransaction, TransactionHandler } from './cursor.ts'
import { type ProgramEvent, parseEvents } from './events.ts'

export type CreatorRow = typeof schema.creators.$inferInsert
export type PledgeRow = typeof schema.pledges.$inferInsert
export type ContributionRow = typeof schema.contributions.$inferInsert

export type IndexWrite =
  | { table: 'creators'; row: CreatorRow }
  | { table: 'pledges'; row: PledgeRow }
  | { table: 'contributions'; row: ContributionRow }

export type IndexWrites = {
  upsertCreator: (row: CreatorRow) => Promise<void>
  upsertPledge: (row: PledgeRow) => Promise<void>
  insertContribution: (row: ContributionRow) => Promise<void>
}

// Runs the writes of one chain transaction inside one database transaction.
export type IndexWriter = (fn: (writes: IndexWrites) => Promise<void>) => Promise<void>

const chainTime = (seconds: bigint): Date => new Date(Number(seconds) * 1000)

export function planWrites(
  tx: ProgramTransaction,
  events: readonly ProgramEvent[],
  ciphertext: RecipientCiphertext | null,
  now: Date,
): IndexWrite[] {
  const writes: IndexWrite[] = []
  for (const event of events) {
    if (event.kind === 'pledged') {
      if (ciphertext === null) throw new Error(`${tx.signature}: Pledged without ciphertext`)
      if (tx.blockTime === null) throw new Error(`${tx.signature}: Pledged without blockTime`)
      const { creator, supporter } = event.data
      writes.push({
        table: 'pledges',
        row: {
          creator,
          supporter,
          startedAt: chainTime(event.data.startedAt),
          expiresAt: chainTime(event.data.expiresAt),
          periodsTotal: event.data.periodsTotal,
          contributions: event.data.contributions,
          showPublicly: event.data.showPublicly,
          lastSig: tx.signature,
          lastSlot: tx.slot.toString(),
        },
      })
      writes.push({
        table: 'contributions',
        row: {
          sig: tx.signature,
          creator,
          supporter,
          slot: tx.slot.toString(),
          blockTime: new Date(tx.blockTime * 1000),
          periods: event.data.periods,
          kind: event.data.contributions === 1 ? 'first' : 'renewal',
          groupedLo: ciphertext.groupedLo,
          groupedHi: ciphertext.groupedHi,
          proofSig: ciphertext.proofSig,
        },
      })
      continue
    }
    writes.push({
      table: 'creators',
      row: {
        wallet: event.data.wallet,
        handle: event.data.handle,
        name: event.data.name,
        description: event.data.description,
        suggestedAmount: event.data.suggestedAmount.toString(),
        createdSlot: event.data.slot.toString(),
        indexedAt: now,
      },
    })
  }
  return writes
}

export type ApplierOptions = {
  writer: IndexWriter
  chain: ChainReader
  now?: () => Date
}

export function createApplier({
  writer,
  chain,
  now = () => new Date(),
}: ApplierOptions): TransactionHandler {
  return async (tx) => {
    if (tx.failed) return
    const events = parseEvents(tx.logs)
    if (events.length === 0) return
    // One Transfer per transaction, hence one ciphertext; read it before the database
    // transaction opens so the pooled connection is not held across RPC round-trips.
    const pledged = events.some((e) => e.kind === 'pledged')
    const ciphertext = pledged ? await fetchRecipientCiphertext(chain, tx.signature) : null
    // The log subscription delivers no block time; the backfill does.
    const blockTime =
      pledged && tx.blockTime === null ? await chain.blockTime(tx.signature) : tx.blockTime
    const writes = planWrites({ ...tx, blockTime }, events, ciphertext, now())
    await writer(async (w) => {
      for (const write of writes) {
        if (write.table === 'creators') await w.upsertCreator(write.row)
        else if (write.table === 'pledges') await w.upsertPledge(write.row)
        else await w.insertContribution(write.row)
      }
    })
  }
}

type Executor = Pick<Db, 'insert'>

// `CreatorUpdated` cannot change the handle and must not move the registration slot.
export const creatorUpsert = (db: Executor, row: CreatorRow) =>
  db
    .insert(schema.creators)
    .values(row)
    .onConflictDoUpdate({
      target: schema.creators.wallet,
      set: {
        name: row.name,
        description: row.description,
        suggestedAmount: row.suggestedAmount,
        indexedAt: row.indexedAt,
      },
    })

export const pledgeUpsert = (db: Executor, row: PledgeRow) =>
  db
    .insert(schema.pledges)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.pledges.creator, schema.pledges.supporter],
      set: {
        startedAt: row.startedAt,
        expiresAt: row.expiresAt,
        periodsTotal: row.periodsTotal,
        contributions: row.contributions,
        showPublicly: row.showPublicly,
        lastSig: row.lastSig,
        lastSlot: row.lastSlot,
      },
    })

export const contributionInsert = (db: Executor, row: ContributionRow) =>
  db
    .insert(schema.contributions)
    .values(row)
    .onConflictDoNothing({ target: schema.contributions.sig })

export function drizzleWriter(db: Db): IndexWriter {
  return (fn) =>
    db.transaction((tx) =>
      fn({
        upsertCreator: async (row) => {
          await creatorUpsert(tx, row)
        },
        upsertPledge: async (row) => {
          await pledgeUpsert(tx, row)
        },
        insertContribution: async (row) => {
          await contributionInsert(tx, row)
        },
      }),
    )
}
