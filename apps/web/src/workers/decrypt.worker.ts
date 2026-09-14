import { decryptContribution, elgamalFromSecret } from '@ccsupport/chain'
import type { PoolRequest, PoolResponse } from '../screens/Dashboard/pool.ts'

// The secret lives in this worker's memory for as long as the pool does; it is
// never written anywhere.
let elgamal: ReturnType<typeof elgamalFromSecret> | null = null

const reply = (response: PoolResponse) => self.postMessage(response)

self.onmessage = ({ data }: MessageEvent<PoolRequest>) => {
  if (data.kind === 'init') {
    elgamal = elgamalFromSecret(data.secret)
    return
  }
  if (!elgamal) throw new Error('decrypt worker received work before its key')
  reply({
    kind: 'result',
    id: data.id,
    result: decryptContribution(elgamal, { groupedLo: data.groupedLo, groupedHi: data.groupedHi }),
  })
}

// The zk-sdk module initialises wasm through a top-level await: a message posted
// before this point is lost silently, so the pool waits for `ready`.
reply({ kind: 'ready' })
