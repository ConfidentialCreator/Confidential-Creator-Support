import { createApp } from '@ccsupport/api/app'
import { createLogger } from '@ccsupport/api/logger'
import { createRelayPayer, type PayerRpc } from '@ccsupport/api/relay/payer'
import { fetchPublicBalance } from '@ccsupport/chain'
import { serve } from '@hono/node-server'
import {
  type Address,
  createKeyPairFromBytes,
  getBase58Encoder,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit'
import type { Sender } from './send.ts'

export type ApiHandle = {
  baseUrl: string
  payer: Address
  stop(): Promise<void>
}

export type ApiInput = {
  rpc: Rpc<SolanaRpcApi>
  sender: Sender
  proofPayerSecret: string
  faucetSecret: string
  mint: Address
  port: number
}

// The API payer reads statuses through the demo's shared poller — no requests of its own.
function payerRpc(rpc: Rpc<SolanaRpcApi>, sender: Sender): PayerRpc {
  return {
    sendTransaction: (wire) =>
      rpc.sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed' }).send(),
    getSignatureStatus: async (signature) => sender.peek(signature),
    isBlockhashValid: async (hash) =>
      (await rpc.isBlockhashValid(hash, { commitment: 'confirmed' }).send()).value,
    getBalance: async (owner) => (await rpc.getBalance(owner).send()).value,
  }
}

// The API lives inside the demo process, not next to it: Helius Free counts `sendTransaction`
// at 1/s per key, and two processes cannot share one lane. The faucet is enabled only here.
export async function startApi(input: ApiInput): Promise<ApiHandle> {
  const keys = getBase58Encoder()
  const port = payerRpc(input.rpc, input.sender)
  const [payer, faucet] = await Promise.all([
    createRelayPayer(port, await createKeyPairFromBytes(keys.encode(input.proofPayerSecret))),
    createRelayPayer(port, await createKeyPairFromBytes(keys.encode(input.faucetSecret))),
  ])
  const app = createApp({
    logger: createLogger('warn'),
    webOrigin: 'http://localhost:5173',
    health: {
      payer: payer.address,
      slot: () => input.rpc.getSlot().send(),
      payerLamports: () => payer.lamports(),
      faucet: {
        lamports: () => faucet.lamports(),
        units: () => fetchPublicBalance(input.rpc, faucet.address, input.mint),
      },
    },
    relay: { payer },
    devnet: { faucet, mint: input.mint, latestBlockhash: () => input.sender.latestBlockhash() },
  })
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port: input.port, hostname: '127.0.0.1' }, () => resolve(s))
  })
  return {
    baseUrl: `http://127.0.0.1:${input.port}`,
    payer: payer.address,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
