import { serve } from '@hono/node-server'
import { createKeyPairFromBytes, createSolanaRpc } from '@solana/kit'
import { createApp } from './app.ts'
import { apiConfigFromEnv } from './config.ts'
import { createLogger } from './logger.ts'
import { createRelayPayer, payerRpcFromKit } from './relay/payer.ts'

async function main(): Promise<void> {
  const config = apiConfigFromEnv(process.env)
  const logger = createLogger(config.logLevel)
  const rpc = createSolanaRpc(config.rpcUrl)
  const payer = await createRelayPayer(
    payerRpcFromKit(rpc),
    await createKeyPairFromBytes(config.proofPayerSecret),
  )

  const app = createApp({
    logger,
    webOrigin: config.webOrigin,
    health: {
      payer: payer.address,
      slot: () => rpc.getSlot().send(),
      payerLamports: () => payer.lamports(),
    },
    relay: { payer },
  })

  const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
    logger.info(
      { port: info.port, payer: payer.address, faucet: config.faucet !== null },
      'api listening',
    )
  })

  // Railway sends SIGTERM on redeploy; in-flight relay requests get to finish and the
  // fallback timer covers one that never does.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.info({ signal }, 'shutting down')
      const forceExit = setTimeout(() => process.exit(1), 10_000)
      server.close(() => {
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
