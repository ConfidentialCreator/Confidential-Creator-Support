import { buildFaucetTopUp } from '@ccsupport/chain'
import { faucetRequestSchema } from '@ccsupport/shared'
import { zValidator } from '@hono/zod-validator'
import {
  type Address,
  appendTransactionMessageInstructions,
  type Blockhash,
  compileTransaction,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'
import { fail } from '../middleware/errors.ts'
import {
  createRateLimiter,
  enforceRateLimit,
  type RateLimiterOptions,
} from '../middleware/rate-limit.ts'
import type { RelayPayer } from '../relay/payer.ts'

// One portion covers a supporter's ATA with the confidential extension, the Pledge
// PDA and a handful of fees (≈ 0.006 SOL), plus a few contributions' worth of SUPD.
export const FAUCET_LAMPORTS = 20_000_000n
export const FAUCET_UNITS = 100_000_000n
export const FAUCET_LIMIT = 3
export const FAUCET_WINDOW_MS = 3_600_000

export type DevnetDeps = {
  faucet: Pick<RelayPayer, 'address' | 'submit'>
  mint: Address
  latestBlockhash: () => Promise<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>
  rateLimit?: RateLimiterOptions
}

const validateBody = zValidator('json', faucetRequestSchema, (result, c) => {
  if (!result.success) {
    return fail(c, 'INVALID_INPUT', 'invalid faucet request', {
      reason: result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    })
  }
})

export function devnetRoute(deps: DevnetDeps): Hono<AppEnv> {
  const limiter = createRateLimiter({
    limit: FAUCET_LIMIT,
    windowMs: FAUCET_WINDOW_MS,
    ...deps.rateLimit,
  })

  return new Hono<AppEnv>().post('/devnet/faucet', validateBody, async (c) => {
    const { wallet } = c.req.valid('json')
    const logger = c.get('logger')

    // Keyed by the wallet, not the IP: the demo script tops up many wallets from one host.
    const limited = enforceRateLimit(c, limiter, wallet)
    if (limited) return limited

    const instructions = await buildFaucetTopUp({
      faucet: deps.faucet.address,
      wallet,
      mint: deps.mint,
      lamports: FAUCET_LAMPORTS,
      units: FAUCET_UNITS,
    })
    const transaction = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(deps.faucet.address, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    )
    const lifetime = await deps.latestBlockhash()
    const sent = await deps.faucet.submit(
      compileTransaction(setTransactionMessageLifetimeUsingBlockhash(lifetime, transaction)),
    )
    if (!sent.ok) {
      logger.error({ wallet, reason: sent.reason }, 'faucet transaction failed')
      return fail(c, 'INTERNAL', 'faucet could not top up the wallet', { reason: sent.reason })
    }

    logger.info({ wallet, signature: sent.signature }, 'faucet topped up')
    return c.json({
      data: {
        signature: sent.signature,
        lamports: Number(FAUCET_LAMPORTS),
        units: Number(FAUCET_UNITS),
      },
    })
  })
}
