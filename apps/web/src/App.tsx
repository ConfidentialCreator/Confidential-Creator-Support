import { CCS_PROGRAM_ID } from '@ccsupport/chain'
import { ConfidentialKeys } from '@solana/zk-sdk'

// Спайк ризику #1 (PLAN): чи збирає Vite bundler-збірку zk-sdk (wasm ESM).
// Прибирається разом із першим справжнім екраном.
const derivationMessage = ConfidentialKeys.signerMessage(new Uint8Array(0))

export function App() {
  return (
    <main className="p-8 font-serif">
      <h1>Confidential Creator Support</h1>
      <p className="font-mono text-sm">program {CCS_PROGRAM_ID}</p>
      <p className="font-mono text-sm">zk-sdk message bytes: {derivationMessage.length}</p>
    </main>
  )
}
