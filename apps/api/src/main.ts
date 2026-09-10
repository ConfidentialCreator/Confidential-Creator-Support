import { fetchPublicBalance } from '@ccsupport/chain'
import { createDb, drizzleCreatorsReader } from '@ccsupport/db'
import { serve } from '@hono/node-server'
import { createKeyPairFromBytes, createSolanaRpc, type Rpc, type SolanaRpcApi } from '@solana/kit'
import { createApp } from './app.ts'
import { type ApiConfig, apiConfigFromEnv } from './config.ts'
import { createLogger } from './logger.ts'
import { createRelayPayer, payerRpcFromKit } from './relay/payer.ts'
import type { DevnetDeps } from './routes/devnet.ts'
import type { HealthDeps } from './routes/health.ts'

async function faucetDeps(
  rpc: Rpc<SolanaRpcApi>,
  faucet: ApiConfig['faucet'],
): Promise<{ health: NonNullable<HealthDeps['faucet']>; devnet: DevnetDeps } | null> {
  if (!faucet) return null
  const signer = await createRelayPayer(
    payerRpcFromKit(rpc),
    await createKeyPairFromBytes(faucet.secret),
  )
  return {
    health: {
      lamports: () => signer.lamports(),
      units: () => fetchPublicBalance(rpc, signer.address, faucet.mint),
    },
    devnet: {
      faucet: signer,
      mint: faucet.mint,
      latestBlockhash: async () =>
        (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value,
    },
  }
}

async function main(): Promise<void> {
  const config = apiConfigFromEnv(process.env)
  const logger = createLogger(config.logLevel)
  const rpc = createSolanaRpc(config.rpcUrl)
  const database = createDb(config.databaseUrl)
  const payer = await createRelayPayer(
    payerRpcFromKit(rpc),
    await createKeyPairFromBytes(config.proofPayerSecret),
  )
  const faucet = await faucetDeps(rpc, config.faucet)

  const app = createApp({
    logger,
    webOrigin: config.webOrigin,
    health: {
      payer: payer.address,
      slot: () => rpc.getSlot().send(),
      payerLamports: () => payer.lamports(),
      ...(faucet && { faucet: faucet.health }),
    },
    relay: { payer },
    creators: { reader: drizzleCreatorsReader(database.db) },
    ...(faucet && { devnet: faucet.devnet }),
  })

  const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
    logger.info(
      { port: info.port, payer: payer.address, faucet: faucet?.devnet.faucet.address ?? null },
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
        database.close().finally(() => {
          clearTimeout(forceExit)
          process.exit(0)
        })
      })
    })
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
