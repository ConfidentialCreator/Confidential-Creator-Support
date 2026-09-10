import { addressSchema } from '@ccsupport/shared'
import { getBase58Encoder } from '@solana/kit'
import { z } from 'zod'

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

// 8080 on the dev machine belongs to Steam.
export const DEFAULT_PORT = 8787
const KEYPAIR_BYTES = 64

const filledEnv = z
  .string()
  .min(1)
  .refine((value) => !value.includes('REPLACE_ME'), {
    message: 'placeholder REPLACE_ME was not replaced',
  })

// Base58 of the 64-byte keypair, the shape `solana-keygen` and wallets export. Only
// the encoding is checked here; the signer is built by the caller.
const keypairSecret = filledEnv.transform((value, ctx) => {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(getBase58Encoder().encode(value))
  } catch {
    ctx.addIssue({ code: 'custom', message: 'expected a base58 string' })
    return z.NEVER
  }
  if (bytes.length !== KEYPAIR_BYTES) {
    ctx.addIssue({ code: 'custom', message: `expected a keypair of ${KEYPAIR_BYTES} bytes` })
    return z.NEVER
  }
  return bytes
})

const flag = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1')

const httpUrl = filledEnv.pipe(z.url({ protocol: /^https?$/ }))
// Only the shape: the pooler port is asserted where the pool is opened.
const postgresUrl = filledEnv.pipe(z.url({ protocol: /^postgres(ql)?$/ }))

export const apiConfigSchema = z
  .object({
    port: z.coerce.number().int().min(1).max(65_535).prefault(DEFAULT_PORT),
    logLevel: z.enum(LOG_LEVELS).prefault('info'),
    webOrigin: httpUrl,
    rpcUrl: httpUrl,
    databaseUrl: postgresUrl,
    proofPayerSecret: keypairSecret,
    faucetEnabled: flag,
    faucetSecret: z.string().optional(),
    mint: z.string().optional(),
  })
  .transform(({ faucetEnabled, faucetSecret, mint, ...rest }, ctx) => {
    if (!faucetEnabled) return { ...rest, faucet: null }
    // The mint is only needed to hand out the demo token, so it is required with the faucet.
    const parsed = z
      .object({ FAUCET_SECRET: keypairSecret, CCS_MINT: filledEnv.pipe(addressSchema) })
      .safeParse({ FAUCET_SECRET: faucetSecret, CCS_MINT: mint })
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ ...issue })
      return z.NEVER
    }
    return { ...rest, faucet: { secret: parsed.data.FAUCET_SECRET, mint: parsed.data.CCS_MINT } }
  })

export type ApiConfig = z.infer<typeof apiConfigSchema>

export function apiConfigFromEnv(env: Record<string, string | undefined>): ApiConfig {
  return apiConfigSchema.parse({
    port: env.API_PORT,
    logLevel: env.LOG_LEVEL,
    webOrigin: env.WEB_ORIGIN,
    rpcUrl: env.SOLANA_RPC_URL,
    databaseUrl: env.DATABASE_URL,
    proofPayerSecret: env.PROOF_PAYER_SECRET,
    faucetEnabled: env.FAUCET_ENABLED,
    faucetSecret: env.FAUCET_SECRET,
    mint: env.CCS_MINT,
  })
}
