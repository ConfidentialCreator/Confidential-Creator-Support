import { type Db, schema } from '@ccsupport/db'
import { eq } from 'drizzle-orm'

export type Cursor = { signature: string; slot: bigint }

// What both the subscription and the backfill deliver; the applier (US1) reads
// events from `logs` and fetches the rest itself.
export type ProgramTransaction = {
  signature: string
  slot: bigint
  blockTime: number | null
  logs: readonly string[]
  failed: boolean
}

export type TransactionHandler = (tx: ProgramTransaction) => Promise<void>

export type CursorStore = {
  load: () => Promise<Cursor | null>
  save: (cursor: Cursor) => Promise<void>
}

type CursorRow = { lastSig: string | null; lastSlot: string | null }

export function rowToCursor(row: CursorRow | undefined): Cursor | null {
  if (row === undefined || row.lastSig === null || row.lastSlot === null) return null
  return { signature: row.lastSig, slot: BigInt(row.lastSlot) }
}

export function cursorStore(db: Db, id: string): CursorStore {
  return {
    load: async () => {
      const rows = await db
        .select({ lastSig: schema.indexerState.lastSig, lastSlot: schema.indexerState.lastSlot })
        .from(schema.indexerState)
        .where(eq(schema.indexerState.id, id))
        .limit(1)
      return rowToCursor(rows[0])
    },
    save: async ({ signature, slot }) => {
      const row = { lastSig: signature, lastSlot: slot.toString(), updatedAt: new Date() }
      await db
        .insert(schema.indexerState)
        .values({ id, ...row })
        .onConflictDoUpdate({ target: schema.indexerState.id, set: row })
    },
  }
}

export type IndexerOptions = {
  store: CursorStore
  initial: Cursor | null
  handle: TransactionHandler
  onError: (err: unknown, tx: ProgramTransaction) => void
}

export type Indexer = {
  push: (tx: ProgramTransaction) => void
  handle: (tx: ProgramTransaction) => Promise<void>
  cursor: () => Cursor | null
  drain: () => Promise<void>
}

// Within one slot the chain has an order but the cursor cannot express it, so a
// small memory of signatures at the cursor's slot tells a duplicate from a sibling.
const RECENT_SIGNATURES = 256

// One transaction at a time, in arrival order: the subscription and the backfill
// both push here, and the applier's upserts must not interleave. A failed handler
// leaves the cursor in place so the next backfill pass retries the same
// transaction; the index stops instead of silently missing a pledge.
export function createIndexer(options: IndexerOptions): Indexer {
  let cursor = options.initial
  const recent: string[] = cursor === null ? [] : [cursor.signature]
  let queue: Promise<void> = Promise.resolve()

  function isBehind(tx: ProgramTransaction): boolean {
    if (cursor === null) return false
    if (tx.slot < cursor.slot) return true
    return tx.slot === cursor.slot && recent.includes(tx.signature)
  }

  async function process(tx: ProgramTransaction): Promise<void> {
    if (isBehind(tx)) return
    try {
      await options.handle(tx)
    } catch (err) {
      options.onError(err, tx)
      return
    }
    cursor = { signature: tx.signature, slot: tx.slot }
    recent.push(tx.signature)
    if (recent.length > RECENT_SIGNATURES) recent.shift()
    await options.store.save(cursor)
  }

  function handle(tx: ProgramTransaction): Promise<void> {
    const next = queue.then(() => process(tx))
    queue = next.catch(() => undefined)
    return next
  }

  return {
    push: (tx) => void handle(tx).catch((err: unknown) => options.onError(err, tx)),
    handle,
    cursor: () => cursor,
    drain: () => queue,
  }
}
