import { describe, expect, it } from 'vitest'
import {
  createDecryptPool,
  type DecryptJob,
  MAX_WORKERS,
  type PoolRequest,
  type PoolResponse,
  poolSize,
  type WorkerLike,
} from './pool.ts'

class FakeWorker implements WorkerLike {
  sent: PoolRequest[] = []
  terminated = false
  onmessage: ((event: { data: PoolResponse }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  postMessage(message: PoolRequest) {
    this.sent.push(message)
  }
  terminate() {
    this.terminated = true
  }
  ready() {
    this.onmessage?.({ data: { kind: 'ready' } })
  }
  answer(id: string, units: bigint) {
    this.onmessage?.({ data: { kind: 'result', id, result: { ok: true, units } } })
  }
  fail(message: string) {
    this.onerror?.({ message })
  }
  inFlight(): string[] {
    return this.sent.flatMap((m) => (m.kind === 'decrypt' ? [m.id] : []))
  }
}

const SECRET = new Uint8Array(32).fill(9)
const job = (id: string): DecryptJob => ({
  id,
  groupedLo: new Uint8Array(128),
  groupedHi: new Uint8Array(128),
})

function setup(size: number) {
  const workers: FakeWorker[] = []
  const pool = createDecryptPool(
    () => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    },
    size,
    SECRET,
  )
  return { pool, workers }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('createDecryptPool', () => {
  it('sends the secret and the work only after the worker said ready', async () => {
    const { pool, workers } = setup(1)
    const [w] = workers
    if (!w) throw new Error('no worker spawned')
    const result = pool.decrypt(job('a'))
    expect(w.sent).toEqual([])
    w.ready()
    expect(w.sent[0]).toEqual({ kind: 'init', secret: SECRET })
    expect(w.inFlight()).toEqual(['a'])
    w.answer('a', 5n)
    expect(await result).toEqual({ ok: true, units: 5n })
  })

  it('spreads jobs over idle workers and hands the queue to whichever finishes first', async () => {
    const { pool, workers } = setup(2)
    const [w1, w2] = workers
    if (!w1 || !w2) throw new Error('expected two workers')
    const results = ['a', 'b', 'c'].map((id) => pool.decrypt(job(id)))
    w1.ready()
    w2.ready()
    expect(w1.inFlight()).toEqual(['a'])
    expect(w2.inFlight()).toEqual(['b'])
    w2.answer('b', 2n)
    expect(w2.inFlight()).toEqual(['b', 'c'])
    expect(w1.inFlight()).toEqual(['a'])
    w1.answer('a', 1n)
    w2.answer('c', 3n)
    expect(await Promise.all(results)).toEqual([
      { ok: true, units: 1n },
      { ok: true, units: 2n },
      { ok: true, units: 3n },
    ])
  })

  it('shares one promise for a job id that is already in flight', async () => {
    const { pool, workers } = setup(1)
    const first = pool.decrypt(job('a'))
    const second = pool.decrypt(job('a'))
    expect(second).toBe(first)
    workers[0]?.ready()
    expect(workers[0]?.inFlight()).toEqual(['a'])
    workers[0]?.answer('a', 1n)
    await first
    // Once settled the id is free again: a re-run of the same job is a new promise.
    expect(pool.decrypt(job('a'))).not.toBe(first)
  })

  it('rejects the job in flight when its worker fails, and everything queued once no worker is left', async () => {
    const { pool, workers } = setup(1)
    const a = pool.decrypt(job('a'))
    const b = pool.decrypt(job('b'))
    workers[0]?.ready()
    workers[0]?.fail('wasm panicked')
    await expect(a).rejects.toThrow(/wasm panicked/)
    await expect(b).rejects.toThrow(/wasm panicked/)
    expect(workers[0]?.terminated).toBe(true)
  })

  it('keeps going on the surviving workers when one fails', async () => {
    const { pool, workers } = setup(2)
    const [w1, w2] = workers
    if (!w1 || !w2) throw new Error('expected two workers')
    const a = pool.decrypt(job('a'))
    const b = pool.decrypt(job('b'))
    const c = pool.decrypt(job('c'))
    w1.ready()
    w2.ready()
    w1.fail('gone')
    await expect(a).rejects.toThrow(/gone/)
    w2.answer('b', 2n)
    await tick()
    expect(w2.inFlight()).toEqual(['b', 'c'])
    w2.answer('c', 3n)
    expect(await Promise.all([b, c])).toEqual([
      { ok: true, units: 2n },
      { ok: true, units: 3n },
    ])
  })

  it('terminate stops every worker and rejects what has not been answered', async () => {
    const { pool, workers } = setup(2)
    const a = pool.decrypt(job('a'))
    workers[0]?.ready()
    pool.terminate()
    expect(workers.every((w) => w.terminated)).toBe(true)
    await expect(a).rejects.toThrow(/terminated/)
    await expect(pool.decrypt(job('b'))).rejects.toThrow(/terminated/)
  })
})

describe('poolSize', () => {
  it('uses the logical cores up to the cap and never fewer than one', () => {
    expect(poolSize(4)).toBe(4)
    expect(poolSize(16)).toBe(MAX_WORKERS)
    expect(poolSize(0)).toBe(1)
    expect(poolSize(undefined)).toBe(1)
  })
})
