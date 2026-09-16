// M1 measurements against the live stack (API + worker + Supabase, separate processes): SC-002
// (transfer confirmation → the counter on the page), SC-003 (wallet signatures and time
// on the same client path as the browser), SC-008 — from `fixtures/demo-run.json`.
// Summary in `fixtures/measure.json`.
//
// Run: pnpm --filter @ccsupport/demo measure [--probes 3] [--api http://127.0.0.1:8787]
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { deriveConfidentialKeys, fetchConfidentialAccount } from '@ccsupport/chain'
import {
  type ApiErrorBody,
  addressSchema,
  apiResponseSchema,
  creatorContributionsSchema,
  creatorProfileSchema,
} from '@ccsupport/shared'
import type { Signature } from '@solana/kit'
import { fetchMint } from '@solana-program/token-2022'
import { z } from 'zod'
import { CREATOR_FILE, DEFAULT_KEYS_DIR, loadOrCreateKeypair, signerFromBase58 } from './keys.ts'
import { type Index, measureSchema, type Probe, runProbe, summarizeMeasure } from './probe.ts'
import { createPacedRpc } from './rpc.ts'
import { CREATOR, demoRunSchema, requireFaucetStock, sweep } from './scenarios/us1.ts'
import { createSender } from './send.ts'
import { contributionPlan, type DemoContext } from './supporters.ts'

const ROOT = new URL('../../../', import.meta.url)
const RUN_FILE = new URL('fixtures/demo-run.json', ROOT)
const MEASURE_FILE = new URL('fixtures/measure.json', ROOT)

// A 1 s step measures the index itself; the page polls every 10 s and adds up to 10 s on top.
const POLL_MS = 1_000
const WATCH_TIMEOUT_MS = 120_000
const RECENT_LIMIT = 10

const blankToUndefined = (value: unknown) => (value === '' ? undefined : value)

const env = z
  .object({
    SOLANA_RPC_URL: z.url({ protocol: /^https?$/ }),
    CCS_MINT: addressSchema,
    CCS_KEYS_DIR: z.preprocess(blankToUndefined, z.string().prefault(DEFAULT_KEYS_DIR)),
    FAUCET_SECRET: z.string().min(1),
  })
  .parse(process.env)

const argv = parseArgs({
  options: { probes: { type: 'string' }, api: { type: 'string' }, rps: { type: 'string' } },
}).values

const args = z
  .object({
    probes: z.coerce.number().int().min(1).max(32).prefault(3),
    api: z.url({ protocol: /^https?$/ }).prefault('http://127.0.0.1:8787'),
    rps: z.coerce.number().positive().prefault(8),
  })
  .parse(argv)

const profileResponse = apiResponseSchema(creatorProfileSchema)
const contributionsResponse = apiResponseSchema(creatorContributionsSchema)
const healthResponse = apiResponseSchema(z.object({ payer: addressSchema }))

async function getJson<T>(url: string, schema: z.ZodType<{ data: T } | ApiErrorBody>): Promise<T> {
  const body = schema.parse(await (await fetch(url)).json())
  if ('error' in body) throw new Error(`${url}: ${body.error.code} ${body.error.message}`)
  return body.data
}

function liveIndex(api: string, handle: string): Index {
  const base = `${api}/creators/${handle}`
  return {
    activeSupporters: async () => (await getJson(base, profileResponse)).activeSupporters,
    hasContribution: async (signature: Signature) =>
      (
        await getJson(`${base}/contributions?limit=${RECENT_LIMIT}`, contributionsResponse)
      ).items.some((item) => item.sig === signature),
  }
}

async function main(): Promise<void> {
  const run = demoRunSchema.parse(JSON.parse(readFileSync(RUN_FILE, 'utf8')))
  const rpc = createPacedRpc(env.SOLANA_RPC_URL, { rps: args.rps, sendRps: 1 })
  const sender = createSender(rpc)
  const faucet = await signerFromBase58(env.FAUCET_SECRET)
  const { signer: creator, created } = await loadOrCreateKeypair(env.CCS_KEYS_DIR, CREATOR_FILE)
  if (created) throw new Error(`${CREATOR_FILE} did not exist: run the demo first`)

  const [{ payer }, profile, { data: mint }, keys, { token }] = await Promise.all([
    getJson(`${args.api}/health`, healthResponse),
    getJson(`${args.api}/creators/${CREATOR.handle}`, profileResponse),
    fetchMint(rpc, env.CCS_MINT),
    deriveConfidentialKeys(creator, creator.address, env.CCS_MINT),
    fetchConfidentialAccount(rpc, creator.address, env.CCS_MINT),
  ])
  if (profile.wallet !== creator.address) {
    throw new Error(
      `${CREATOR.handle} in the index is ${profile.wallet}, local key is ${creator.address}`,
    )
  }
  console.log(
    `api ${args.api}  payer ${payer}  creator ${creator.address}  supporters ${profile.activeSupporters}`,
  )

  const ctx: DemoContext = {
    rpc,
    sender,
    api: { baseUrl: args.api, payer },
    mint: env.CCS_MINT,
    decimals: mint.decimals,
    creator: { wallet: creator.address, token, keys },
    faucet,
  }
  await requireFaucetStock(ctx, {
    supporters: args.probes,
    repeats: args.probes,
    concurrency: 1,
    rps: args.rps,
  })
  const index = liveIndex(args.api, CREATOR.handle)
  const watch = {
    intervalMs: POLL_MS,
    timeoutMs: WATCH_TIMEOUT_MS,
    now: () => performance.now(),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }

  const startedAt = new Date()
  const probes: Probe[] = []
  const signers = []
  // Sequential: the 1/s `sendTransaction` lane is shared with the API in the neighbouring process.
  for (let i = 0; i < args.probes; i += 1) {
    const plan = contributionPlan(i, args.probes)
    if (!plan.repeat) throw new Error('every probe repeats')
    const { probe, signer } = await runProbe(ctx, i, { ...plan, repeat: plan.repeat }, index, watch)
    probes.push(probe)
    signers.push(signer)
    const line = probe.contributions
      .map(
        (c) =>
          `${c.kind} ${(c.confirmedMs / 1000).toFixed(1)}s, ${c.signatures.transactions} tx + ${c.signatures.messages} msg${c.counter ? `, counter +1 in ${(c.counter.ms / 1000).toFixed(1)}s` : ''}${c.indexed ? `, indexed in ${(c.indexed.ms / 1000).toFixed(1)}s` : ', NOT indexed'}`,
      )
      .join(' · ')
    console.log(
      `[${i + 1}/${args.probes}] ${probe.wallet} ${probe.error ? `FAILED: ${probe.error}` : line}`,
    )
  }
  const swept = await sweep(ctx, signers)
  console.log(`sweep: ${swept.length} tx`)

  const measure = measureSchema.parse({
    cluster: 'devnet',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    api: args.api,
    handle: CREATOR.handle,
    probes,
    summary: summarizeMeasure(probes, run),
  })
  writeFileSync(MEASURE_FILE, `${JSON.stringify(measure, null, 2)}\n`)

  const s = measure.summary
  const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`
  console.log('\n=== SUMMARY ===')
  console.log(`probes: ${probes.length - s.failed} ok, ${s.failed} failed`)
  console.log(
    `SC-001 no amount trace: ${s.sc001.clean}/${s.sc001.checked} — ${s.sc001.pass ? 'PASS' : 'FAIL'}`,
  )
  console.log(
    `SC-002 counter ≤ 30 s after confirmation: max ${sec(s.sc002.maxMs)} (n=${s.sc002.samples}) — ${s.sc002.pass ? 'PASS' : 'FAIL'}`,
  )
  console.log(
    `SC-003 first: p95 ${sec(s.sc003.first.p95Ms)}, ≤ ${s.sc003.first.signaturesMax} signatures (n=${s.sc003.first.samples}); repeat: p95 ${sec(s.sc003.repeat.p95Ms)}, ≤ ${s.sc003.repeat.signaturesMax} signatures (n=${s.sc003.repeat.samples}); CLI p95 ${sec(s.sc003.cliP95Ms.first)} / ${sec(s.sc003.cliP95Ms.repeat)} — ${s.sc003.pass ? 'PASS' : 'FAIL'}`,
  )
  console.log(
    `SC-008 demo set ${(s.sc008.totalMs / 60_000).toFixed(1)} min — ${s.sc008.pass ? 'PASS' : 'FAIL'}`,
  )
  console.log(`→ ${fileURLToPath(MEASURE_FILE)}`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
