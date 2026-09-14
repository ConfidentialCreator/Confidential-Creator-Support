import type { ConfidentialKeys, DecryptResult } from '@ccsupport/chain'
import type { Address } from '@ccsupport/shared'
import { useEffect, useReducer, useState } from 'react'
import type { Contribution } from '../../api/creators.ts'
import {
  createDecryptPool,
  type DecryptPool,
  type PoolResponse,
  poolSize,
  type WorkerLike,
} from './pool.ts'
import { decodeHalf } from './summary.ts'

// Amounts already recovered in this tab, so a return to the cabinet costs no
// logarithms. Keyed by owner: another wallet in the same tab must start over.
const recovered = new Map<string, DecryptResult>()
const cacheKey = (owner: Address, sig: string) => `${owner}:${sig}`

export type Timing = { startedAt: number; firstAt: number | null; allAt: number | null }

export type Amounts = {
  amountOf: (sig: string) => DecryptResult | undefined
  timing: Timing | null
  error: string | null
}

function spawnWorker(): WorkerLike {
  const worker = new Worker(new URL('../../workers/decrypt.worker.ts', import.meta.url), {
    type: 'module',
  })
  const like: WorkerLike = {
    postMessage: (message) => worker.postMessage(message),
    onmessage: null,
    onerror: null,
    terminate: () => worker.terminate(),
  }
  worker.onmessage = (event: MessageEvent<PoolResponse>) => like.onmessage?.(event)
  worker.onerror = (event) => like.onerror?.(event)
  return like
}

export function useAmounts(
  keys: ConfidentialKeys | null,
  owner: Address,
  items: readonly Contribution[],
): Amounts {
  const [pool, setPool] = useState<DecryptPool | null>(null)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [timing, setTiming] = useState<Timing | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!keys) return
    const created = createDecryptPool(
      spawnWorker,
      poolSize(navigator.hardwareConcurrency),
      keys.elgamal().secret().toBytes(),
    )
    setPool(created)
    return () => {
      created.terminate()
      setPool(null)
    }
  }, [keys])

  useEffect(() => {
    if (!pool) return
    const todo = items.filter((c) => !recovered.has(cacheKey(owner, c.sig)))
    if (todo.length === 0) return
    const latest: Timing = { startedAt: performance.now(), firstAt: null, allAt: null }
    let done = 0
    let cancelled = false
    // Results land one per worker message; a render per result keeps the main thread
    // busy and the workers idle waiting for their next job. One render per frame.
    let frame: number | null = null
    const flush = () => {
      frame = null
      if (cancelled) return
      setTiming({ ...latest })
      bump()
    }
    setTiming({ ...latest })
    for (const c of todo) {
      pool
        .decrypt({
          id: c.sig,
          groupedLo: decodeHalf(c.groupedLo),
          groupedHi: decodeHalf(c.groupedHi),
        })
        .then(
          (result) => {
            if (cancelled) return
            recovered.set(cacheKey(owner, c.sig), result)
            done += 1
            const now = performance.now()
            latest.firstAt ??= now
            if (done === todo.length) latest.allAt = now
            frame ??= requestAnimationFrame(flush)
          },
          (err: unknown) => {
            if (!cancelled) setError(err instanceof Error ? err.message : String(err))
          },
        )
    }
    return () => {
      cancelled = true
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [pool, owner, items])

  return {
    amountOf: (sig) => (keys ? recovered.get(cacheKey(owner, sig)) : undefined),
    timing,
    error,
  }
}
