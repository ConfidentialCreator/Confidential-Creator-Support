import { relayRequestSchema } from '@ccsupport/shared'
import { zValidator } from '@hono/zod-validator'
import type { Address, Transaction } from '@solana/kit'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { fail } from '../middleware/errors.ts'
import type { RelayPayer } from '../relay/payer.ts'
import { type RelayMode, validateRelayTransaction } from '../relay/validate.ts'

export type RelayDeps = {
  payer: Pick<RelayPayer, 'address' | 'submit'>
}

type Batch = { ok: true; transactions: Transaction[] } | { ok: false; reason: string }

type Relayed =
  | { ok: true; signatures: string[] }
  | { ok: false; kind: 'rejected' | 'failed'; reason: string; signatures: string[] }

const validateBody = zValidator('json', relayRequestSchema, (result, c) => {
  if (!result.success) {
    return fail(c, 'INVALID_INPUT', 'invalid relay request', {
      reason: result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    })
  }
})

// Every transaction is checked before the first one is sent: a batch with a bad
// member must not leave context-state accounts behind on the payer's rent.
function validateBatch(wires: string[], payer: Address, mode: RelayMode): Batch {
  const transactions: Transaction[] = []
  for (const [index, wire] of wires.entries()) {
    const result = validateRelayTransaction(wire, payer, mode)
    if (!result.ok) return { ok: false, reason: `transaction ${index}: ${result.reason}` }
    transactions.push(result.transaction)
  }
  return { ok: true, transactions }
}

// Sequential on purpose: a Record `Write` sent alongside its `Initialize` lands in
// any order, and the range proof that follows needs the record complete.
async function submitBatch(
  payer: RelayDeps['payer'],
  transactions: Transaction[],
): Promise<Relayed> {
  const signatures: string[] = []
  for (const [index, transaction] of transactions.entries()) {
    const sent = await payer.submit(transaction)
    if (!sent.ok) {
      return { ...sent, reason: `transaction ${index}: ${sent.reason}`, signatures }
    }
    signatures.push(sent.signature)
  }
  return { ok: true, signatures }
}

export function relayRoute(deps: RelayDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  for (const mode of ['proofs', 'close'] as const) {
    app.post(`/relay/${mode}`, validateBody, async (c) => {
      const logger = c.get('logger')

      const batch = validateBatch(c.req.valid('json').transactions, deps.payer.address, mode)
      if (!batch.ok) {
        logger.warn({ mode, reason: batch.reason }, 'relay rejected')
        return fail(c, 'INVALID_INPUT', 'transaction not allowed through the relay', {
          reason: batch.reason,
        })
      }

      const relayed = await submitBatch(deps.payer, batch.transactions)
      if (!relayed.ok) {
        const details = { reason: relayed.reason, signatures: relayed.signatures }
        if (relayed.kind === 'rejected') {
          logger.warn({ mode, ...details }, 'relay transaction rejected by the network')
          return fail(c, 'INVALID_INPUT', 'transaction rejected by the network', details)
        }
        logger.error({ mode, ...details }, 'relay transaction failed')
        return fail(c, 'INTERNAL', 'transaction could not be confirmed', details)
      }

      logger.info({ mode, signatures: relayed.signatures }, 'relayed')
      return c.json({ data: { signatures: relayed.signatures } })
    })
  }

  return app
}
