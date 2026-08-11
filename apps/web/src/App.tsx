import { CCS_PROGRAM_ID } from '@ccsupport/chain'
import {
  type ContributionCiphertext,
  decryptCombined,
  decryptSplit,
  encryptContribution,
  HANDLE,
  timed,
} from '@ccsupport/demo/spike/decrypt-bench'
import { ElGamalKeypair } from '@solana/zk-sdk'
import { useState } from 'react'
import type { WorkerRequest, WorkerResponse } from './spike.worker.ts'

// Спайк T007 (ризик #3): розшифрування 128 внесків на головному потоці й у пулі
// воркерів. Прибирається разом із першим справжнім екраном (T005).
const COUNT = 128
const source = new ElGamalKeypair()
const destination = new ElGamalKeypair()
const auditor = new ElGamalKeypair()
const amounts = Array.from(
  { length: COUNT },
  (_, i) => BigInt(1 + ((i * 7919) % 1000)) * 1_000_000n,
)
const ciphertexts = amounts.map((amount) =>
  encryptContribution(
    { source: source.pubkey(), destination: destination.pubkey(), auditor: auditor.pubkey() },
    amount,
  ),
)

const now = () => performance.now()
const secs = (ms: number) => `${(ms / 1000).toFixed(2)} s`

function runMainThread(mode: 'split' | 'combined'): string {
  const decrypt = mode === 'split' ? decryptSplit : decryptCombined
  const run = timed(ciphertexts, (c) => decrypt(destination.secret(), HANDLE.destination, c), now)
  const ok = run.results.every((v, i) => v === amounts[i])
  return `main ${mode}: ${COUNT} за ${secs(run.totalMs)}, mean ${run.meanMs.toFixed(0)} ms, max ${run.maxMs.toFixed(0)} ms, ${ok ? 'ok' : 'MISMATCH'}`
}

type WorkerDone = Extract<WorkerResponse, { kind: 'done' }>

function runInWorker(chunk: ContributionCiphertext[]): Promise<WorkerDone> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./spike.worker.ts', import.meta.url), { type: 'module' })
    const request: WorkerRequest = {
      secret: new Uint8Array(destination.secret().toBytes()),
      ciphertexts: chunk,
    }
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.kind === 'ready') {
        worker.postMessage(request)
        return
      }
      worker.terminate()
      resolve(event.data)
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
  })
}

async function runWorkerPool(size: number): Promise<string> {
  const started = now()
  const chunks = Array.from({ length: size }, (_, w) =>
    ciphertexts.filter((_, i) => i % size === w),
  )
  const responses = await Promise.all(chunks.map(runInWorker))
  const wallMs = now() - started
  const ok = chunks.every((chunk, w) =>
    chunk.every((c, j) => responses[w]?.amounts[j] === amounts[ciphertexts.indexOf(c)]?.toString()),
  )
  const busiest = Math.max(...responses.map((r) => r.totalMs))
  return `workers ×${size} combined: ${COUNT} за ${secs(wallMs)} wall (найдовший воркер ${secs(busiest)}), ${ok ? 'ok' : 'MISMATCH'}`
}

export function App() {
  const [lines, setLines] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const append = (line: string) => setLines((prev) => [...prev, line])
  const guard = async (job: () => Promise<string> | string) => {
    setBusy(true)
    try {
      append(await job())
    } catch (error) {
      append(`error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }
  const cores = navigator.hardwareConcurrency

  return (
    <main className="p-8 font-serif">
      <h1>Confidential Creator Support</h1>
      <p className="font-mono text-sm">program {CCS_PROGRAM_ID}</p>
      <p className="font-mono text-sm">
        spike T007: {COUNT} внесків, {cores} logical cores
      </p>
      <div className="flex gap-2 py-4">
        <button type="button" disabled={busy} onClick={() => guard(() => runMainThread('split'))}>
          main split
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => guard(() => runMainThread('combined'))}
        >
          main combined
        </button>
        <button type="button" disabled={busy} onClick={() => guard(() => runWorkerPool(1))}>
          worker ×1
        </button>
        <button type="button" disabled={busy} onClick={() => guard(() => runWorkerPool(4))}>
          workers ×4
        </button>
        <button type="button" disabled={busy} onClick={() => guard(() => runWorkerPool(cores))}>
          workers ×{cores}
        </button>
      </div>
      <ul className="font-mono text-sm" data-testid="results">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </main>
  )
}
