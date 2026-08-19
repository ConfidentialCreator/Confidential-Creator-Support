import { describe, expect, it } from 'vitest'
import {
  type Cursor,
  type CursorStore,
  createIndexer,
  type ProgramTransaction,
  rowToCursor,
} from './cursor.ts'

function tx(signature: string, slot: number): ProgramTransaction {
  return { signature, slot: BigInt(slot), blockTime: null, logs: [], failed: false }
}

function memoryStore(initial: Cursor | null = null) {
  let saved: Cursor | null = initial
  const saves: Cursor[] = []
  const store: CursorStore = {
    load: () => Promise.resolve(saved),
    save: (cursor) => {
      saved = cursor
      saves.push(cursor)
      return Promise.resolve()
    },
  }
  return { store, saves, current: () => saved }
}

describe('rowToCursor', () => {
  it('reads numeric(20,0) slot as bigint and treats a row without signature as empty', () => {
    expect(rowToCursor({ lastSig: 'sig', lastSlot: '18446744073709551615' })).toEqual({
      signature: 'sig',
      slot: 18446744073709551615n,
    })
    expect(rowToCursor({ lastSig: null, lastSlot: null })).toBeNull()
    expect(rowToCursor({ lastSig: 'sig', lastSlot: null })).toBeNull()
    expect(rowToCursor(undefined)).toBeNull()
  })
})

describe('createIndexer', () => {
  it('handles in arrival order, one at a time, and moves the cursor after each', async () => {
    const { store, saves } = memoryStore()
    const seen: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    const indexer = createIndexer({
      store,
      initial: null,
      handle: async (t) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 1))
        seen.push(t.signature)
        inFlight--
      },
      onError: () => {},
    })
    indexer.push(tx('a', 1))
    indexer.push(tx('b', 2))
    indexer.push(tx('c', 2))
    await indexer.drain()
    expect(seen).toEqual(['a', 'b', 'c'])
    expect(maxInFlight).toBe(1)
    expect(saves.map((c) => c.signature)).toEqual(['a', 'b', 'c'])
    expect(indexer.cursor()).toEqual({ signature: 'c', slot: 2n })
  })

  it('skips what is behind the cursor and a same-slot signature seen already', async () => {
    const { store } = memoryStore()
    const seen: string[] = []
    const indexer = createIndexer({
      store,
      initial: { signature: 'b', slot: 5n },
      handle: async (t) => {
        seen.push(t.signature)
      },
      onError: () => {},
    })
    indexer.push(tx('a', 4))
    indexer.push(tx('b', 5))
    indexer.push(tx('c', 5))
    indexer.push(tx('c', 5))
    indexer.push(tx('d', 6))
    await indexer.drain()
    expect(seen).toEqual(['c', 'd'])
  })

  it('keeps the cursor where it was when the handler fails, and goes on', async () => {
    const { store, current } = memoryStore()
    const errors: string[] = []
    const indexer = createIndexer({
      store,
      initial: null,
      handle: async (t) => {
        if (t.signature === 'b') throw new Error('rpc down')
      },
      onError: (_err, t) => {
        errors.push(t.signature)
      },
    })
    indexer.push(tx('a', 1))
    indexer.push(tx('b', 2))
    indexer.push(tx('c', 3))
    await indexer.drain()
    expect(errors).toEqual(['b'])
    expect(current()).toEqual({ signature: 'c', slot: 3n })
  })

  it('awaits a pushed transaction through `handle`', async () => {
    const { store } = memoryStore()
    const indexer = createIndexer({
      store,
      initial: null,
      handle: async () => {},
      onError: () => {},
    })
    await indexer.handle(tx('a', 1))
    expect(indexer.cursor()).toEqual({ signature: 'a', slot: 1n })
  })
})
