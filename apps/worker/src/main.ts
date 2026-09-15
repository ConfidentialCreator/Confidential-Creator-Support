import { CCSUPPORT_PROGRAM_ADDRESS } from '@ccsupport/chain'
import { createDb } from '@ccsupport/db'
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'
import { pino } from 'pino'
import { createApplier, drizzleWriter } from './apply.ts'
import { backfill, rpcFor } from './backfill.ts'
import { chainReader } from './ciphertext.ts'
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
  const programId = CCSUPPORT_PROGRAM_ADDRESS
  const database = createDb(config.databaseUrl)
  const store = cursorStore(database.db, CCSUPPORT_PROGRAM_ADDRESS)
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
  logger.info(
    { program: CCSUPPORT_PROGRAM_ADDRESS, rpc: new URL(config.rpcUrl).host },
    'worker listening',
  )

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
