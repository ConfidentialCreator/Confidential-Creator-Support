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

export const apiConfigSchema = z
  .object({
    port: z.coerce.number().int().min(1).max(65_535).prefault(DEFAULT_PORT),
    logLevel: z.enum(LOG_LEVELS).prefault('info'),
    webOrigin: httpUrl,
    rpcUrl: httpUrl,
    proofPayerSecret: keypairSecret,
    faucetEnabled: flag,
    faucetSecret: z.string().optional(),
  })
  .transform(({ faucetEnabled, faucetSecret, ...rest }, ctx) => {
    if (!faucetEnabled) return { ...rest, faucet: null }
    const parsed = keypairSecret.safeParse(faucetSecret)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: ['FAUCET_SECRET'] })
      return z.NEVER
    }
    return { ...rest, faucet: { secret: parsed.data } }
  })

export type ApiConfig = z.infer<typeof apiConfigSchema>

export function apiConfigFromEnv(env: Record<string, string | undefined>): ApiConfig {
  return apiConfigSchema.parse({
    port: env.API_PORT,
    logLevel: env.LOG_LEVEL,
    webOrigin: env.WEB_ORIGIN,
    rpcUrl: env.SOLANA_RPC_URL,
    proofPayerSecret: env.PROOF_PAYER_SECRET,
    faucetEnabled: env.FAUCET_ENABLED,
    faucetSecret: env.FAUCET_SECRET,
  })
}
