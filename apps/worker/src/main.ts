import { createDb } from '@ccsupport/db'
import { pino } from 'pino'
import { workerConfigFromEnv } from './config.ts'
import { startWorker } from './run.ts'

const SHUTDOWN_GRACE_MS = 10_000

async function main(): Promise<void> {
  const config = workerConfigFromEnv(process.env)
  const logger = pino({
    level: config.logLevel,
    base: { service: 'worker' },
    timestamp: pino.stdTimeFunctions.isoTime,
  })
  const database = createDb(config.databaseUrl)
  const worker = await startWorker({ config, logger, database })

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.info({ signal }, 'shutting down')
      const forceExit = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS)
      worker
        .stop()
        .then(() => database.close())
        .finally(() => {
          clearTimeout(forceExit)
          process.exit(0)
        })
    })
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
