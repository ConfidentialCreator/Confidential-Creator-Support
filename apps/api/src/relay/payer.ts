import type { webcrypto } from 'node:crypto'
import {
  type Address,
  type Base64EncodedWireTransaction,
  type Blockhash,
  blockhash,
  type Commitment,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  isSolanaError,
  partiallySignTransaction,
  type Rpc,
  type Signature,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  type SolanaRpcApi,
  type Transaction,
  type TransactionError,
} from '@solana/kit'

export const CONFIRM_POLL_MS = 1_000
// Under a blockhash lifetime (~60 s); past it the blockhash check ends the wait anyway.
export const CONFIRM_TIMEOUT_MS = 45_000

export type SignatureStatus = {
  confirmationStatus: Commitment | null
  err: TransactionError | null
}

export type PayerRpc = {
  sendTransaction(wire: Base64EncodedWireTransaction): Promise<Signature>
  getSignatureStatus(signature: Signature): Promise<SignatureStatus | null>
  isBlockhashValid(hash: Blockhash): Promise<boolean>
  getBalance(owner: Address): Promise<bigint>
}

// `rejected` — the transaction itself will never land (preflight, on-chain error,
// expired blockhash): the client rebuilds. `failed` — we could not find out.
export type SubmitResult =
  | { ok: true; signature: Signature }
  | { ok: false; kind: 'rejected' | 'failed'; reason: string }

export type RelayPayer = {
  address: Address
  lamports(): Promise<bigint>
  submit(transaction: Transaction): Promise<SubmitResult>
}

export type PayerOptions = {
  pollMs?: number
  timeoutMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const SETTLED: ReadonlySet<Commitment> = new Set(['confirmed', 'finalized'])

function settle(status: SignatureStatus | null, signature: Signature): SubmitResult | null {
  if (status?.err) {
    return { ok: false, kind: 'rejected', reason: `failed on chain: ${JSON.stringify(status.err)}` }
  }
  if (status?.confirmationStatus && SETTLED.has(status.confirmationStatus)) {
    return { ok: true, signature }
  }
  return null
}

export function payerRpcFromKit(rpc: Rpc<SolanaRpcApi>): PayerRpc {
  return {
    sendTransaction: (wire) =>
      rpc.sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed' }).send(),
    getSignatureStatus: async (signature) =>
      (await rpc.getSignatureStatuses([signature]).send()).value[0] ?? null,
    isBlockhashValid: async (hash) =>
      (await rpc.isBlockhashValid(hash, { commitment: 'confirmed' }).send()).value,
    getBalance: async (owner) => (await rpc.getBalance(owner).send()).value,
  }
}

function describeError(err: unknown): string {
  if (isSolanaError(err, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) {
    const cause = err.cause instanceof Error ? `: ${err.cause.message}` : ''
    return `${err.message}${cause}`
  }
  return err instanceof Error ? err.message : String(err)
}

export async function createRelayPayer(
  rpc: PayerRpc,
  keyPair: webcrypto.CryptoKeyPair,
  options: PayerOptions = {},
): Promise<RelayPayer> {
  const address = await getAddressFromPublicKey(keyPair.publicKey)
  const pollMs = options.pollMs ?? CONFIRM_POLL_MS
  const timeoutMs = options.timeoutMs ?? CONFIRM_TIMEOUT_MS
  const now = options.now ?? (() => Date.now())
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  async function confirm(signature: Signature, hash: Blockhash): Promise<SubmitResult> {
    const deadline = now() + timeoutMs
    while (true) {
      const status = await rpc.getSignatureStatus(signature)
      const settled = settle(status, signature)
      if (settled) return settled
      // The RPC keeps resending until the blockhash expires; once it has and the
      // signature is still unknown, the transaction is gone for good.
      if (status === null && !(await rpc.isBlockhashValid(hash))) {
        return { ok: false, kind: 'rejected', reason: 'blockhash expired before confirmation' }
      }
      if (now() >= deadline) {
        return { ok: false, kind: 'failed', reason: `not confirmed within ${timeoutMs} ms` }
      }
      await sleep(pollMs)
    }
  }

  return {
    address,
    lamports: () => rpc.getBalance(address),
    async submit(transaction) {
      const signed = await partiallySignTransaction([keyPair], transaction)
      const hash = blockhash(
        getCompiledTransactionMessageDecoder().decode(signed.messageBytes).lifetimeToken,
      )
      try {
        await rpc.sendTransaction(getBase64EncodedWireTransaction(signed))
      } catch (err) {
        const preflight = isSolanaError(
          err,
          SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
        )
        return { ok: false, kind: preflight ? 'rejected' : 'failed', reason: describeError(err) }
      }
      return confirm(getSignatureFromTransaction(signed), hash)
    },
  }
}
