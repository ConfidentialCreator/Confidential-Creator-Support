import type { Address } from '@solana/kit'
import { Hono } from 'hono'
import type { AppEnv } from '../env.ts'

export const HEALTH_TIMEOUT_MS = 2_000

export type HealthDeps = {
  payer: Address
  slot: () => Promise<bigint>
  payerLamports: () => Promise<bigint>
  timeoutMs?: number
}

// A dependency that hangs is, for a healthcheck, the same as one that failed —
// without a cap the probe hangs as long as the RPC does and Railway sees a timeout
// instead of `ok: false`.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dependency did not answer in ${ms} ms`)), ms)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

// `ok` is reachability of the RPC — what the Railway probe and the keep-alive ask.
// `payerLamports` is the operator's gauge for topping up; a low balance is not an
// outage, so it never flips `ok`.
export function healthRoute(deps: HealthDeps): Hono<AppEnv> {
  const timeoutMs = deps.timeoutMs ?? HEALTH_TIMEOUT_MS

  const { payer } = deps

  return new Hono<AppEnv>().get('/health', async (c) => {
    try {
      const [slot, payerLamports] = await withTimeout(
        Promise.all([deps.slot(), deps.payerLamports()]),
        timeoutMs,
      )
      return c.json({
        data: { ok: true, slot: Number(slot), payer, payerLamports: Number(payerLamports) },
      })
    } catch (err) {
      c.get('logger')?.error({ err }, 'health check failed')
      return c.json({ data: { ok: false, slot: null, payer, payerLamports: null } }, 503)
    }
  })
}
