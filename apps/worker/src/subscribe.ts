import type { Address, RpcSubscriptions, SolanaRpcSubscriptionsApi } from '@solana/kit'
import type { ProgramTransaction } from './cursor.ts'

export type LogNotification = {
  context: { slot: bigint }
  value: { signature: string; err: unknown; logs: readonly string[] }
}

// One websocket connection: an iterable that ends (or throws) when the socket does.
export type LogSource = (signal: AbortSignal) => Promise<AsyncIterable<LogNotification>>

// Logs arriving here are always the confirmed commitment: `processed` can be rolled
// back, and a rolled-back pledge in the index would be a lie.
export function logSourceFor(
  subscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  programId: Address,
): LogSource {
  return (abortSignal) =>
    subscriptions
      .logsNotifications({ mentions: [programId] }, { commitment: 'confirmed' })
      .subscribe({ abortSignal })
}

export type SubscribeOptions = {
  source: LogSource
  onTransaction: (tx: ProgramTransaction) => void
  onError: (err: unknown) => void
  retryMs: number
  signal: AbortSignal
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

// The subscription is the fast path; the backfill on a timer is the complete one.
// A dropped socket therefore costs latency, never records — reconnecting here is
// only about getting the latency back.
export async function subscribeLogs(options: SubscribeOptions): Promise<void> {
  const { source, onTransaction, onError, retryMs, signal } = options
  while (!signal.aborted) {
    try {
      const notifications = await source(signal)
      for await (const { context, value } of notifications) {
        // The subscription carries no blockTime; the applier reads it where needed.
        onTransaction({
          signature: value.signature,
          slot: context.slot,
          blockTime: null,
          logs: value.logs,
          failed: value.err !== null,
        })
      }
    } catch (err) {
      if (!signal.aborted) onError(err)
    }
    if (!signal.aborted) await sleep(retryMs, signal)
  }
}
