// Демо-набір US1 на devnet (SC-001, SC-003, SC-008, FR-015): автор + N синтетичних
// прихильників через faucet і relay власного API, підсумок у `fixtures/demo-run.json`.
//
// Запуск: pnpm --filter @ccsupport/demo demo [--supporters 128] [--repeats 24] [--concurrency 6]
//   [--rps 8] [--send-rps 1]
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { addressSchema } from '@ccsupport/shared'
import { fetchMint } from '@solana-program/token-2022'
import { z } from 'zod'
import { CREATOR_FILE, DEFAULT_KEYS_DIR, loadOrCreateKeypair, signerFromBase58 } from './keys.ts'
import { createPacedRpc } from './rpc.ts'
import { runUs1 } from './scenarios/us1.ts'
import { createSender } from './send.ts'
import { startApi } from './server.ts'

const ROOT = new URL('../../../', import.meta.url)
const RUN_FILE = new URL('fixtures/demo-run.json', ROOT)

const blankToUndefined = (value: unknown) => (value === '' ? undefined : value)

const env = z
  .object({
    SOLANA_RPC_URL: z.url({ protocol: /^https?$/ }),
    CCS_MINT: addressSchema,
    CCS_KEYS_DIR: z.preprocess(blankToUndefined, z.string().prefault(DEFAULT_KEYS_DIR)),
    // Ті самі ключі, що й у `pnpm dev` API: платник доказів і faucet.
    PROOF_PAYER_SECRET: z.string().min(1),
    FAUCET_SECRET: z.string().min(1),
  })
  .parse(process.env)

const argv = parseArgs({
  options: {
    supporters: { type: 'string' },
    repeats: { type: 'string' },
    concurrency: { type: 'string' },
    rps: { type: 'string' },
    'send-rps': { type: 'string' },
    port: { type: 'string' },
  },
}).values

const args = z
  .object({
    supporters: z.coerce.number().int().min(1).prefault(128),
    repeats: z.coerce.number().int().min(0).prefault(24),
    // Стільки, щоб смуга `sendTransaction` 1/с не простоювала, поки інші чекають підтверджень.
    concurrency: z.coerce.number().int().min(1).max(32).prefault(6),
    rps: z.coerce.number().positive().prefault(8),
    sendRps: z.coerce.number().positive().prefault(1),
    port: z.coerce.number().int().prefault(8787),
  })
  .parse({ ...argv, sendRps: argv['send-rps'] })

async function main(): Promise<void> {
  const rpc = createPacedRpc(env.SOLANA_RPC_URL, { rps: args.rps, sendRps: args.sendRps })
  const sender = createSender(rpc)
  const faucet = await signerFromBase58(env.FAUCET_SECRET)
  const { signer: creator, created } = await loadOrCreateKeypair(env.CCS_KEYS_DIR, CREATOR_FILE)
  console.log(`${CREATOR_FILE} ${created ? 'generated' : 'loaded'}  faucet ${faucet.address}`)

  const api = await startApi({
    rpc,
    sender,
    proofPayerSecret: env.PROOF_PAYER_SECRET,
    faucetSecret: env.FAUCET_SECRET,
    mint: env.CCS_MINT,
    port: args.port,
  })
  console.log(`api ${api.baseUrl}  relay payer ${api.payer}`)
  try {
    const { data: mint } = await fetchMint(rpc, env.CCS_MINT)
    const run = await runUs1(
      { rpc, sender, api, mint: env.CCS_MINT, decimals: mint.decimals, faucet },
      creator,
      args,
      (line) => console.log(line),
    )
    mkdirSync(new URL('fixtures/', ROOT), { recursive: true })
    writeFileSync(RUN_FILE, `${JSON.stringify(run, null, 2)}\n`)

    const s = run.summary
    console.log('\n=== ПІДСУМОК ===')
    console.log(
      `прихильників: ${s.succeeded} ок, ${s.failed} відмов; час ${(s.sc008.totalMs / 60_000).toFixed(1)} хв`,
    )
    console.log(
      `SC-001 без сліду суми: ${s.sc001.clean}/${s.sc001.checked} — ${s.sc001.pass ? 'PASS' : 'FAIL'}`,
    )
    console.log(
      `SC-003 перший p95 ${(s.sc003.firstP95Ms / 1000).toFixed(1)} s (max ${(s.sc003.firstMaxMs / 1000).toFixed(1)}), повторний p95 ${(s.sc003.repeatP95Ms / 1000).toFixed(1)} s (max ${(s.sc003.repeatMaxMs / 1000).toFixed(1)}, n=${s.sc003.repeatSamples}) — ${s.sc003.pass ? 'PASS' : 'FAIL'}`,
    )
    console.log(`SC-008 ≤ 30 хв без ручних кроків — ${s.sc008.pass ? 'PASS' : 'FAIL'}`)
    console.log(
      `FR-015 розшифровано ключами автора: ${s.fr015.decryptedMatched}/${s.sc001.checked}, баланс автора зійшовся: ${s.fr015.creatorBalanceMatches} — ${s.fr015.pass ? 'PASS' : 'FAIL'}`,
    )
    console.log(`→ ${fileURLToPath(RUN_FILE)}`)
  } finally {
    await api.stop()
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
