import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env.ts'
import { fail } from './errors.ts'

export const RATE_LIMIT = 20
export const WINDOW_MS = 60_000
const SWEEP_EVERY = 512

export type RateLimitOptions = {
  limit?: number
  windowMs?: number
  now?: () => number
  clientKey?: (c: Context<AppEnv>) => string
}

// Behind the proxy the real address is the LAST entry of x-forwarded-for: every hop
// appends, so the last one was written by the trusted node closest to us, while the
// first ones the client can write itself.
export function clientIp(c: Context<AppEnv>): string {
  const last = c.req
    .header('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .at(-1)
  return last ?? c.req.header('x-real-ip') ?? 'unknown'
}

// Sliding window of request timestamps per key. A fixed window is cheaper but lets
// twice the limit through at the boundary of two windows. The counter lives in the
// process: one container on Railway, no Redis in the stack.
export function rateLimit(options: RateLimitOptions = {}): MiddlewareHandler<AppEnv> {
  const limit = options.limit ?? RATE_LIMIT
  const windowMs = options.windowMs ?? WINDOW_MS
  const now = options.now ?? (() => Date.now())
  const clientKey = options.clientKey ?? clientIp
  const windows = new Map<string, number[]>()
  let sinceSweep = 0

  function prune(window: number[], threshold: number): number[] {
    const firstAlive = window.findIndex((at) => at > threshold)
    return firstAlive === -1 ? [] : window.slice(firstAlive)
  }

  return async (c, next) => {
    const at = now()
    const threshold = at - windowMs
    const key = clientKey(c)

    // No timer: setInterval would keep the process alive and tie tests to the clock.
    if (++sinceSweep >= SWEEP_EVERY) {
      sinceSweep = 0
      for (const [otherKey, window] of windows) {
        const alive = prune(window, threshold)
        if (alive.length === 0) windows.delete(otherKey)
        else windows.set(otherKey, alive)
      }
    }

    const window = prune(windows.get(key) ?? [], threshold)
    const oldest = window[0]
    c.header('RateLimit-Limit', String(limit))

    if (window.length >= limit && oldest !== undefined) {
      windows.set(key, window)
      const resetSeconds = Math.max(1, Math.ceil((oldest + windowMs - at) / 1000))
      c.header('RateLimit-Remaining', '0')
      c.header('RateLimit-Reset', String(resetSeconds))
      c.header('Retry-After', String(resetSeconds))
      c.get('logger')?.warn({ key, limit, windowMs }, 'rate limited')
      return fail(c, 'RATE_LIMITED', `too many requests: limit is ${limit} per minute`)
    }

    window.push(at)
    windows.set(key, window)
    c.header('RateLimit-Remaining', String(limit - window.length))
    await next()
  }
}
