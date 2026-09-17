import { CCSUPPORT_PROGRAM_ADDRESS } from '@ccsupport/chain'
import type { DbHandle } from '@ccsupport/db'
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'
import type { Logger } from 'pino'
import { createApplier, drizzleWriter } from './apply.ts'
import { backfill, rpcFor } from './backfill.ts'
import { chainReader } from './ciphertext.ts'
import type { WorkerConfig } from './config.ts'
import { createIndexer, cursorStore } from './cursor.ts'
import { logSourceFor, subscribeLogs } from './subscribe.ts'

const BACKFILL_EVERY_MS = 30_000
const RECONNECT_MS = 5_000

export type WorkerHandle = { stop(): Promise<void> }

export type StartWorkerInput = {
  config: Pick<WorkerConfig, 'rpcUrl' | 'wsUrl'>
  logger: Logger
  // Owned by the caller: the api shares its pool when the worker runs in-process.
  database: DbHandle
}

// Backfill first, then the subscription; the timer keeps backfilling in case the
// socket drops a notification. `stop` drains what is in flight and returns.
export async function startWorker({
  config,
  logger,
  database,
}: StartWorkerInput): Promise<WorkerHandle> {
  const programId = CCSUPPORT_PROGRAM_ADDRESS
  const store = cursorStore(database.db, programId)
  const solana = createSolanaRpc(config.rpcUrl)
  const rpc = rpcFor(solana, programId)

  const indexer = createIndexer({
    store,
    initial: await store.load(),
    handle: createApplier({ writer: drizzleWriter(database.db), chain: chainReader(solana) }),
    onError: (err, tx) => logger.error({ err, signature: tx.signature }, 'apply failed'),
  })

  let passing = false
  async function backfillPass(): Promise<void> {
    if (passing) return
    passing = true
    try {
      const since = indexer.cursor()?.signature ?? null
      const latest = await backfill(rpc, since, indexer.handle)
      logger.info({ since, latest: latest?.signature ?? null }, 'backfill pass')
    } catch (err) {
      logger.warn({ err }, 'backfill failed')
    } finally {
      passing = false
    }
  }

  await backfillPass()
  const stop = new AbortController()
  const subscription = subscribeLogs({
    source: logSourceFor(createSolanaRpcSubscriptions(config.wsUrl), programId),
    onTransaction: indexer.push,
    onError: (err) => logger.warn({ err, retryMs: RECONNECT_MS }, 'subscription dropped'),
    retryMs: RECONNECT_MS,
    signal: stop.signal,
  })
  const timer = setInterval(() => void backfillPass(), BACKFILL_EVERY_MS)
  // The Helius key sits in the query string: only the host goes to the log.
  logger.info({ program: programId, rpc: new URL(config.rpcUrl).host }, 'worker listening')

  return {
    stop: async () => {
      clearInterval(timer)
      stop.abort()
      await subscription
      await indexer.drain()
    },
  }
}
