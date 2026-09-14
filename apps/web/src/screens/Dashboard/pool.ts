import type { DecryptResult } from '@ccsupport/chain'

export type PoolRequest =
  | { kind: 'init'; secret: Uint8Array }
  | { kind: 'decrypt'; id: string; groupedLo: Uint8Array; groupedHi: Uint8Array }

export type PoolResponse = { kind: 'ready' } | { kind: 'result'; id: string; result: DecryptResult }

export type WorkerLike = {
  postMessage(message: PoolRequest): void
  onmessage: ((event: { data: PoolResponse }) => void) | null
  onerror: ((event: { message: string }) => void) | null
  terminate(): void
}

export type DecryptJob = { id: string; groupedLo: Uint8Array; groupedHi: Uint8Array }

export type DecryptPool = {
  decrypt(job: DecryptJob): Promise<DecryptResult>
  terminate(): void
}

// One logarithm is ~100 ms of wasm; beyond eight workers the page loads the
// wasm module more often than it saves.
export const MAX_WORKERS = 8

export function poolSize(hardwareConcurrency: number | undefined): number {
  return Math.min(MAX_WORKERS, Math.max(1, hardwareConcurrency ?? 1))
}

type Pending = { job: DecryptJob; resolve: (r: DecryptResult) => void; reject: (e: Error) => void }
type Slot = { worker: WorkerLike; ready: boolean; current: Pending | null }

export function createDecryptPool(
  spawn: () => WorkerLike,
  size: number,
  secret: Uint8Array,
): DecryptPool {
  const queue: Pending[] = []
  const inFlight = new Map<string, Promise<DecryptResult>>()
  let slots: Slot[] = []
  let terminated = false

  function pump() {
    for (const slot of slots) {
      if (!slot.ready || slot.current) continue
      const next = queue.shift()
      if (!next) return
      slot.current = next
      const { id, groupedLo, groupedHi } = next.job
      slot.worker.postMessage({ kind: 'decrypt', id, groupedLo, groupedHi })
    }
  }

  function drop(slot: Slot, error: Error) {
    slot.worker.terminate()
    slots = slots.filter((s) => s !== slot)
    slot.current?.reject(error)
    if (slots.length === 0) for (const p of queue.splice(0)) p.reject(error)
  }

  for (let i = 0; i < size; i++) {
    const slot: Slot = { worker: spawn(), ready: false, current: null }
    slots.push(slot)
    slot.worker.onmessage = ({ data }) => {
      if (data.kind === 'ready') {
        // The module initialises wasm through a top-level await: anything posted
        // before this message is lost, so the secret goes only now.
        slot.worker.postMessage({ kind: 'init', secret })
        slot.ready = true
      } else if (slot.current?.job.id === data.id) {
        const done = slot.current
        slot.current = null
        done.resolve(data.result)
      }
      pump()
    }
    slot.worker.onerror = ({ message }) => drop(slot, new Error(message))
  }

  return {
    decrypt(job) {
      if (terminated) return Promise.reject(new Error('decrypt pool terminated'))
      const known = inFlight.get(job.id)
      if (known) return known
      const promise = new Promise<DecryptResult>((resolve, reject) => {
        queue.push({ job, resolve, reject })
        pump()
      }).finally(() => inFlight.delete(job.id))
      inFlight.set(job.id, promise)
      return promise
    },
    terminate() {
      terminated = true
      const error = new Error('decrypt pool terminated')
      for (const slot of slots.splice(0)) {
        slot.worker.terminate()
        slot.current?.reject(error)
      }
      for (const p of queue.splice(0)) p.reject(error)
    },
  }
}
