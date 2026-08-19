import { z } from 'zod'

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

const filledEnv = z
  .string()
  .min(1)
  .refine((value) => !value.includes('REPLACE_ME'), {
    message: 'placeholder REPLACE_ME was not replaced',
  })

const httpUrl = filledEnv.pipe(z.url({ protocol: /^https?$/ }))

// Helius and the public devnet node serve websockets on the same host, path and
// query as HTTP — one variable in the environment instead of two that can drift.
export function wsUrlFor(rpcUrl: string): string {
  const url = new URL(rpcUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export const workerConfigSchema = z
  .object({
    // The pooler port is enforced by createDb, where the string is actually used.
    databaseUrl: filledEnv.pipe(z.url({ protocol: /^postgres(ql)?$/ })),
    rpcUrl: httpUrl,
    logLevel: z.enum(LOG_LEVELS).prefault('info'),
  })
  .transform((config) => ({ ...config, wsUrl: wsUrlFor(config.rpcUrl) }))

export type WorkerConfig = z.infer<typeof workerConfigSchema>

export function workerConfigFromEnv(env: Record<string, string | undefined>): WorkerConfig {
  return workerConfigSchema.parse({
    databaseUrl: env.DATABASE_URL,
    rpcUrl: env.SOLANA_RPC_URL,
    logLevel: env.LOG_LEVEL,
  })
}
