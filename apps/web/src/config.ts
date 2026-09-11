import { addressSchema } from '@ccsupport/shared'
import { z } from 'zod'

const blankAsMissing = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value))

const webEnvSchema = z.object({
  VITE_API_URL: blankAsMissing.pipe(
    z
      .url({ protocol: /^https?$/ })
      .optional()
      .transform((value) => value ?? 'http://localhost:8787'),
  ),
  VITE_CCS_MINT: blankAsMissing.pipe(addressSchema.optional()),
  // Reads only (blockhash, account lookups); sending goes through the wallet's own RPC.
  VITE_SOLANA_RPC_URL: blankAsMissing.pipe(
    z
      .url({ protocol: /^https?$/ })
      .optional()
      .transform((value) => value ?? 'https://api.devnet.solana.com'),
  ),
  VITE_SOLANA_CLUSTER: blankAsMissing.pipe(
    z
      .enum(['devnet', 'testnet', 'mainnet', 'localnet'])
      .optional()
      .transform((value) => value ?? 'devnet'),
  ),
})

export type SolanaChain = `solana:${z.infer<typeof webEnvSchema>['VITE_SOLANA_CLUSTER']}`

export type WebEnv = {
  apiUrl: string
  mint: z.infer<typeof addressSchema> | undefined
  rpcUrl: string
  chain: SolanaChain
}

export function parseWebEnv(raw: Record<string, string | undefined>): WebEnv {
  const env = webEnvSchema.parse(raw)
  return {
    apiUrl: env.VITE_API_URL,
    mint: env.VITE_CCS_MINT,
    rpcUrl: env.VITE_SOLANA_RPC_URL,
    chain: `solana:${env.VITE_SOLANA_CLUSTER}`,
  }
}

export const webEnv = parseWebEnv(import.meta.env)
