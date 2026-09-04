import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env.ts'
import { fail } from './errors.ts'

export const RATE_LIMIT = 20
export const WINDOW_MS = 60_000
const SWEEP_EVERY = 512

export type RateLimiterOptions = {
  limit?: number
  windowMs?: number
  now?: () => number
}

export type RateLimitOptions = RateLimiterOptions & {
  clientKey?: (c: Context<AppEnv>) => string
}

export type RateLimitVerdict =
  | { allowed: true; remaining: number }
  | { allowed: false; resetSeconds: number }

export type RateLimiter = {
  limit: number
  windowMs: number
  hit(key: string): RateLimitVerdict
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
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const limit = options.limit ?? RATE_LIMIT
  const windowMs = options.windowMs ?? WINDOW_MS
  const now = options.now ?? (() => Date.now())
  const windows = new Map<string, number[]>()
  let sinceSweep = 0

  function prune(window: number[], threshold: number): number[] {
    const firstAlive = window.findIndex((at) => at > threshold)
    return firstAlive === -1 ? [] : window.slice(firstAlive)
  }

  return {
    limit,
    windowMs,
    hit(key) {
      const at = now()
      const threshold = at - windowMs

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
      if (window.length >= limit && oldest !== undefined) {
        windows.set(key, window)
        return {
          allowed: false,
          resetSeconds: Math.max(1, Math.ceil((oldest + windowMs - at) / 1000)),
        }
      }
      window.push(at)
      windows.set(key, window)
      return { allowed: true, remaining: limit - window.length }
    },
  }
}

// Returns the 429 response when the key is over budget, otherwise null after
// stamping the RateLimit-* headers.
export function enforceRateLimit(
  c: Context<AppEnv>,
  limiter: RateLimiter,
  key: string,
): Response | null {
  const verdict = limiter.hit(key)
  c.header('RateLimit-Limit', String(limiter.limit))
  if (verdict.allowed) {
    c.header('RateLimit-Remaining', String(verdict.remaining))
    return null
  }
  c.header('RateLimit-Remaining', '0')
  c.header('RateLimit-Reset', String(verdict.resetSeconds))
  c.header('Retry-After', String(verdict.resetSeconds))
  c.get('logger')?.warn({ key, limit: limiter.limit, windowMs: limiter.windowMs }, 'rate limited')
  return fail(
    c,
    'RATE_LIMITED',
    `too many requests: limit is ${limiter.limit} per ${limiter.windowMs / 1000} s`,
  )
}

export function rateLimit(options: RateLimitOptions = {}): MiddlewareHandler<AppEnv> {
  const limiter = createRateLimiter(options)
  const clientKey = options.clientKey ?? clientIp
  return async (c, next) => {
    const limited = enforceRateLimit(c, limiter, clientKey(c))
    if (limited) return limited
    await next()
  }
}
