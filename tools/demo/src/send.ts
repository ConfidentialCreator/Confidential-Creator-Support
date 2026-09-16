import {
  appendTransactionMessageInstructions,
  type Blockhash,
  type Commitment,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Instruction,
  pipe,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionError,
  type TransactionMessage,
  type TransactionMessageWithFeePayer,
  type TransactionSigner,
} from '@solana/kit'

export type Message = TransactionMessage & TransactionMessageWithFeePayer
export type Lifetime = { blockhash: Blockhash; lastValidBlockHeight: bigint }
export type Status = { confirmationStatus: Commitment | null; err: TransactionError | null }

export type Sender = {
  latestBlockhash(): Promise<Lifetime>
  send(message: Message): Promise<Signature>
  sendInstructions(feePayer: TransactionSigner, instructions: Instruction[]): Promise<Signature>
  // The last known status; the signature joins the shared polling queue.
  peek(signature: Signature): Status | null
}

export type SenderOptions = {
  pollMs?: number
  timeoutMs?: number
  blockhashTtlMs?: number
}

const SETTLED: ReadonlySet<Commitment> = new Set(['confirmed', 'finalized'])
const STATUS_BATCH = 256
const PEEK_TTL_MS = 90_000

// No WS: Helius Free allows 5 connections, and more supporters are in flight. One
// `getSignatureStatuses` per second for every signature of the process — the API payer's too.
export function createSender(rpc: Rpc<SolanaRpcApi>, options: SenderOptions = {}): Sender {
  const pollMs = options.pollMs ?? 1_000
  const timeoutMs = options.timeoutMs ?? 60_000
  const blockhashTtlMs = options.blockhashTtlMs ?? 5_000

  const known = new Map<Signature, { status: Status | null; since: number }>()
  const waiters = new Map<Signature, { resolve(status: Status): void; deadline: number }>()
  let polling: Promise<void> | null = null

  async function pollOnce(): Promise<void> {
    const signatures = [...known.keys()].slice(0, STATUS_BATCH)
    if (signatures.length === 0) return
    const { value } = await rpc.getSignatureStatuses(signatures).send()
    signatures.forEach((signature, i) => {
      const status = value[i] ?? null
      const entry = known.get(signature)
      if (entry) entry.status = status
      const waiter = waiters.get(signature)
      if (!waiter) return
      if (status?.err || (status?.confirmationStatus && SETTLED.has(status.confirmationStatus))) {
        waiter.resolve(status)
        waiters.delete(signature)
        known.delete(signature)
      } else if (Date.now() >= waiter.deadline) {
        waiter.resolve({ confirmationStatus: null, err: null })
        waiters.delete(signature)
        known.delete(signature)
      }
    })
    // Signatures nobody awaits (the payer's peek) live until finalisation or until the
    // blockhash expires — nobody asks about them after that.
    for (const [signature, entry] of known) {
      if (waiters.has(signature)) continue
      if (
        entry.status?.confirmationStatus === 'finalized' ||
        Date.now() - entry.since > PEEK_TTL_MS
      ) {
        known.delete(signature)
      }
    }
  }

  function ensurePolling(): void {
    if (polling) return
    polling = (async () => {
      while (known.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, pollMs))
        try {
          await pollOnce()
        } catch {
          // a 429 after all attempts — the next cycle tries again
        }
      }
      polling = null
    })()
  }

  function track(signature: Signature): Promise<Status> {
    return new Promise((resolve) => {
      waiters.set(signature, { resolve, deadline: Date.now() + timeoutMs })
      known.set(signature, { status: null, since: Date.now() })
      ensurePolling()
    })
  }

  let cached: { lifetime: Lifetime; at: number } | null = null
  // `finalized`, not `confirmed`: behind the Helius balancer there is sometimes a lagging
  // node, and it rejects a fresh confirmed blockhash as "not found" on preflight.
  async function latestBlockhash(): Promise<Lifetime> {
    if (cached && Date.now() - cached.at < blockhashTtlMs) return cached.lifetime
    const { value } = await rpc.getLatestBlockhash({ commitment: 'finalized' }).send()
    cached = { lifetime: value, at: Date.now() }
    return value
  }

  async function send(message: Message): Promise<Signature> {
    const transaction = await signTransactionMessageWithSigners(
      setTransactionMessageLifetimeUsingBlockhash(await latestBlockhash(), message),
    )
    const signature = getSignatureFromTransaction(transaction)
    await rpc
      .sendTransaction(getBase64EncodedWireTransaction(transaction), {
        encoding: 'base64',
        preflightCommitment: 'confirmed',
      })
      .send()
    const status = await track(signature)
    if (status.err) throw new Error(`${signature} failed on chain: ${JSON.stringify(status.err)}`)
    if (!status.confirmationStatus) {
      throw new Error(`${signature} not confirmed within ${timeoutMs} ms`)
    }
    return signature
  }

  return {
    latestBlockhash,
    send,
    sendInstructions: (feePayer, instructions) =>
      send(
        pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayerSigner(feePayer, m),
          (m) => appendTransactionMessageInstructions(instructions, m),
        ),
      ),
    peek(signature) {
      if (!known.has(signature)) {
        known.set(signature, { status: null, since: Date.now() })
        ensurePolling()
      }
      return known.get(signature)?.status ?? null
    },
  }
}
