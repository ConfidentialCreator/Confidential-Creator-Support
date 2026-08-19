import { CCS_PROGRAM_ID } from '@ccsupport/chain'
import { createDb } from '@ccsupport/db'
import { address, createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'
import { pino } from 'pino'
import { backfill, rpcFor } from './backfill.ts'
import { workerConfigFromEnv } from './config.ts'
import { createIndexer, cursorStore } from './cursor.ts'
import { logSourceFor, subscribeLogs } from './subscribe.ts'

const BACKFILL_EVERY_MS = 30_000
const RECONNECT_MS = 5_000
const SHUTDOWN_GRACE_MS = 10_000

async function main(): Promise<void> {
  const config = workerConfigFromEnv(process.env)
  const logger = pino({
    level: config.logLevel,
    base: { service: 'worker' },
    timestamp: pino.stdTimeFunctions.isoTime,
  })
  const programId = address(CCS_PROGRAM_ID)
  const database = createDb(config.databaseUrl)
  const store = cursorStore(database.db, CCS_PROGRAM_ID)
  const rpc = rpcFor(createSolanaRpc(config.rpcUrl), programId)

  const indexer = createIndexer({
    store,
    initial: await store.load(),
    // The applier arrives with US1; until then the cursor follows the chain over
    // transactions that carry no events yet.
    handle: async () => {},
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
  logger.info({ program: CCS_PROGRAM_ID, rpc: config.rpcUrl }, 'worker listening')

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.info({ signal }, 'shutting down')
      clearInterval(timer)
      stop.abort()
      const forceExit = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS)
      void subscription
        .then(() => indexer.drain())
        .then(() => database.close())
        .finally(() => {
          clearTimeout(forceExit)
          process.exit(0)
        })
    })
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `worker failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
})
