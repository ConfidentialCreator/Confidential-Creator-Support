import {
  type ContributionCiphertext,
  decryptCombined,
  HANDLE,
  timed,
} from '@ccsupport/demo/spike/decrypt-bench'
import { ElGamalSecretKey } from '@solana/zk-sdk'

export type WorkerRequest = { secret: Uint8Array; ciphertexts: ContributionCiphertext[] }
export type WorkerResponse =
  | { kind: 'ready' }
  | { kind: 'done'; amounts: Array<string | undefined>; totalMs: number }

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const secret = ElGamalSecretKey.fromBytes(event.data.secret)
  const run = timed(
    event.data.ciphertexts,
    (c) => decryptCombined(secret, HANDLE.destination, c)?.toString(),
    () => performance.now(),
  )
  const response: WorkerResponse = { kind: 'done', amounts: run.results, totalMs: run.totalMs }
  self.postMessage(response)
}

// Модуль ініціалізує wasm через top-level await; повідомлення, надіслане до цього,
// губиться — тому головний потік чекає «ready», перш ніж слати роботу.
const ready: WorkerResponse = { kind: 'ready' }
self.postMessage(ready)
