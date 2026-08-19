import { describe, expect, it } from 'vitest'
import { type BackfillRpc, backfill, type SignatureInfo } from './backfill.ts'

// Chain history, oldest first: s1 … sN with slot = index.
function history(count: number): SignatureInfo[] {
  return Array.from({ length: count }, (_, i) => ({ signature: `s${i + 1}`, slot: BigInt(i + 1) }))
}

// Mimics getSignaturesForAddress: newest first, `before` exclusive, `until` exclusive.
function scripted(all: SignatureInfo[], missing: string[] = []) {
  const calls: { before?: string; until?: string; limit: number }[] = []
  const rpc: BackfillRpc = {
    signatures: (options) => {
      calls.push(options)
      const newestFirst = [...all].reverse()
      const start =
        options.before === undefined
          ? 0
          : newestFirst.findIndex((s) => s.signature === options.before) + 1
      const stop =
        options.until === undefined
          ? newestFirst.length
          : newestFirst.findIndex((s) => s.signature === options.until)
      return Promise.resolve(newestFirst.slice(start, stop).slice(0, options.limit))
    },
    transaction: (signature) => {
      if (missing.includes(signature)) return Promise.resolve(null)
      const info = all.find((s) => s.signature === signature)
      if (info === undefined) return Promise.resolve(null)
      return Promise.resolve({
        signature,
        slot: info.slot,
        blockTime: 1_700_000_000 + Number(info.slot),
        logs: [`Program log: ${signature}`],
        failed: false,
      })
    },
  }
  return { rpc, calls }
}

async function collect(rpc: BackfillRpc, since: string | null, pageSize: number) {
  const seen: string[] = []
  const latest = await backfill(
    rpc,
    since,
    (tx) => {
      seen.push(tx.signature)
      return Promise.resolve()
    },
    pageSize,
  )
  return { seen, latest }
}

describe('backfill', () => {
  it('replays everything after the cursor, oldest first, and returns the newest', async () => {
    const { rpc } = scripted(history(5))
    const { seen, latest } = await collect(rpc, 's2', 10)
    expect(seen).toEqual(['s3', 's4', 's5'])
    expect(latest).toEqual({ signature: 's5', slot: 5n })
  })

  it('pages backwards with `before` until a short page', async () => {
    const { rpc, calls } = scripted(history(7))
    const { seen } = await collect(rpc, null, 3)
    expect(seen).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7'])
    expect(calls.map((c) => c.before)).toEqual([undefined, 's5', 's2'])
  })

  it('stops at a signature the rpc does not serve yet, cursor before it', async () => {
    const { rpc } = scripted(history(4), ['s3'])
    const { seen, latest } = await collect(rpc, null, 10)
    expect(seen).toEqual(['s1', 's2'])
    expect(latest).toEqual({ signature: 's2', slot: 2n })
  })

  it('returns null when nothing is newer than the cursor', async () => {
    const { rpc } = scripted(history(2))
    const { seen, latest } = await collect(rpc, 's2', 10)
    expect(seen).toEqual([])
    expect(latest).toBeNull()
  })
})
