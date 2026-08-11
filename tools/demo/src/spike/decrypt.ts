// Спайк S2 (T007): скільки коштує розшифрувати 128 внесків у Node. Той самий
// бенч у браузері запускає заглушка `apps/web/src/App.tsx`.
//
// Запуск: pnpm --filter @ccsupport/demo spike:decrypt [N]
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

// Внески 1..1000 токенів при 6 знаках — усі нижче 2^32 одиниць.
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

console.log(`Node ${process.version}, ${count} внесків\n`)
report('шифрування (lo + hi, 3 хендли)', encryption)

const split = timed(
  ciphertexts,
  (c) => decryptSplit(destination.secret(), HANDLE.destination, c),
  now,
)
report('автор, split — 2 DL на внесок', split)
const combined = timed(
  ciphertexts,
  (c) => decryptCombined(destination.secret(), HANDLE.destination, c),
  now,
)
report('автор, combined — 1 DL на внесок', combined)
const auditorRun = timed(
  ciphertexts,
  (c) => decryptCombined(auditor.secret(), HANDLE.auditor, c),
  now,
)
report('аудитор, combined', auditorRun)
const wrong = timed(
  ciphertexts.slice(0, 8),
  (c) => decryptCombined(stranger.secret(), HANDLE.destination, c),
  now,
)
report('чужий ключ, combined (8 шт., усі undefined)', wrong)

const balances = amounts.map((amount) => aes.encrypt(amount).toBytes())
const aesRun = timed(balances, (b) => decryptAvailable(aes, b), now)
report('AES decryptable balance', aesRun)

const ok =
  split.results.every((v, i) => v === amounts[i]) &&
  combined.results.every((v, i) => v === amounts[i]) &&
  auditorRun.results.every((v, i) => v === amounts[i]) &&
  wrong.results.every((v) => v === undefined) &&
  aesRun.results.every((v, i) => v === amounts[i])
console.log(`\nзвірка сум: ${ok ? 'ok' : 'MISMATCH'}`)
if (!ok) process.exit(1)
