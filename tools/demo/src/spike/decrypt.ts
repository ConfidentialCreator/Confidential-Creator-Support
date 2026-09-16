// Spike S2 (T007): what it costs to decrypt 128 contributions in Node. The same
// bench in the browser is run by the `apps/web/src/App.tsx` stub.
//
// Run: pnpm --filter @ccsupport/demo spike:decrypt [N]
import { AeKey, ElGamalKeypair } from '@solana/zk-sdk'
import {
  decryptAvailable,
  decryptCombined,
  decryptSplit,
  encryptContribution,
  HANDLE,
  timed,
} from './decrypt-bench.ts'

const count = Number(process.argv[2] ?? 128)
const now = () => performance.now()

const source = new ElGamalKeypair()
const destination = new ElGamalKeypair()
const auditor = new ElGamalKeypair()
const stranger = new ElGamalKeypair()
const aes = new AeKey()

// Contributions of 1..1000 tokens at 6 decimals — all below 2^32 units.
const amounts = Array.from(
  { length: count },
  (_, i) => BigInt(1 + ((i * 7919) % 1000)) * 1_000_000n,
)

const encryption = timed(
  amounts,
  (amount) =>
    encryptContribution(
      { source: source.pubkey(), destination: destination.pubkey(), auditor: auditor.pubkey() },
      amount,
    ),
  now,
)
const ciphertexts = encryption.results

const fmt = (ms: number) => `${(ms / 1000).toFixed(2)} s`
function report(label: string, result: { totalMs: number; meanMs: number; maxMs: number }) {
  console.log(
    `${label.padEnd(44)} total ${fmt(result.totalMs).padStart(8)}  mean ${result.meanMs.toFixed(0).padStart(4)} ms  max ${result.maxMs.toFixed(0).padStart(4)} ms`,
  )
}

console.log(`Node ${process.version}, ${count} contributions\n`)
report('encryption (lo + hi, 3 handles)', encryption)

const split = timed(
  ciphertexts,
  (c) => decryptSplit(destination.secret(), HANDLE.destination, c),
  now,
)
report('creator, split — 2 DL per contribution', split)
const combined = timed(
  ciphertexts,
  (c) => decryptCombined(destination.secret(), HANDLE.destination, c),
  now,
)
report('creator, combined — 1 DL per contribution', combined)
const auditorRun = timed(
  ciphertexts,
  (c) => decryptCombined(auditor.secret(), HANDLE.auditor, c),
  now,
)
report('auditor, combined', auditorRun)
const wrong = timed(
  ciphertexts.slice(0, 8),
  (c) => decryptCombined(stranger.secret(), HANDLE.destination, c),
  now,
)
report('foreign key, combined (8 of them, all undefined)', wrong)

const balances = amounts.map((amount) => aes.encrypt(amount).toBytes())
const aesRun = timed(balances, (b) => decryptAvailable(aes, b), now)
report('AES decryptable balance', aesRun)

const ok =
  split.results.every((v, i) => v === amounts[i]) &&
  combined.results.every((v, i) => v === amounts[i]) &&
  auditorRun.results.every((v, i) => v === amounts[i]) &&
  wrong.results.every((v) => v === undefined) &&
  aesRun.results.every((v, i) => v === amounts[i])
console.log(`\namount check: ${ok ? 'ok' : 'MISMATCH'}`)
if (!ok) process.exit(1)
