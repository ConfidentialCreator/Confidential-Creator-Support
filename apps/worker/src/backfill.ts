import type { Address, Rpc, Signature, SolanaRpcApi } from '@solana/kit'
import type { ProgramTransaction, TransactionHandler } from './cursor.ts'

export const PAGE_SIZE = 1000

export type SignatureInfo = { signature: string; slot: bigint }

// The two RPC calls behind a backfill, so paging and ordering are tested against a
// scripted history instead of a network.
export type BackfillRpc = {
  signatures: (options: {
    before?: string
    until?: string
    limit: number
  }) => Promise<SignatureInfo[]>
  transaction: (signature: string) => Promise<ProgramTransaction | null>
}

export function rpcFor(rpc: Rpc<SolanaRpcApi>, programId: Address): BackfillRpc {
  return {
    signatures: async ({ before, until, limit }) => {
      const page = await rpc
        .getSignaturesForAddress(programId, {
          ...(before === undefined ? {} : { before: before as Signature }),
          ...(until === undefined ? {} : { until: until as Signature }),
          limit,
          commitment: 'confirmed',
        })
        .send()
      return page.map((info) => ({ signature: info.signature, slot: info.slot }))
    },
    transaction: async (signature) => {
      const tx = await rpc
        .getTransaction(signature as Signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
          encoding: 'json',
        })
        .send()
      if (tx === null) return null
      return {
        signature,
        slot: tx.slot,
        blockTime: tx.blockTime === null ? null : Number(tx.blockTime),
        logs: tx.meta?.logMessages ?? [],
        failed: tx.meta?.err !== null && tx.meta?.err !== undefined,
      }
    },
  }
}

// `getSignaturesForAddress` walks backwards from the tip; `until` stops it at the
// cursor. Pages are collected first and replayed oldest → newest so the handler
// sees history in chain order and the cursor only ever moves forward.
export async function backfill(
  rpc: BackfillRpc,
  since: string | null,
  handle: TransactionHandler,
  pageSize = PAGE_SIZE,
): Promise<SignatureInfo | null> {
  const pending: SignatureInfo[] = []
  let before: string | undefined
  for (;;) {
    const page = await rpc.signatures({
      ...(before === undefined ? {} : { before }),
      ...(since === null ? {} : { until: since }),
      limit: pageSize,
    })
    pending.push(...page)
    const last = page.at(-1)
    if (page.length < pageSize || last === undefined) break
    before = last.signature
  }

  let latest: SignatureInfo | null = null
  for (const info of pending.reverse()) {
    const tx = await rpc.transaction(info.signature)
    // A signature the RPC listed but does not serve yet (not at this commitment on
    // this node) ends the pass here: the cursor stays before it, the next pass retries.
    if (tx === null) break
    await handle(tx)
    latest = info
  }
  return latest
}
