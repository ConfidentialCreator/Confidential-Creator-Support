// SC-005 on devnet through the hosted api: a fresh supporter pledges one period, then renews
// one more before the date while the api is read every second. No reading may show the
// pledge lapsed or the creator's counter moving; the new expiry must be the old one plus a
// period. Summary in `fixtures/renewal.json`.
//
// Run: pnpm --filter @ccsupport/demo renewal [--api https://ccsupport-api.onrender.com]
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { deriveConfidentialKeys, fetchConfidentialAccount } from '@ccsupport/chain'
import {
  type ApiErrorBody,
  addressSchema,
  apiResponseSchema,
  creatorProfileSchema,
  PERIOD_SECONDS,
  supporterPledgesSchema,
} from '@ccsupport/shared'
import { generateKeyPairSigner } from '@solana/kit'
import { fetchMint } from '@solana-program/token-2022'
import { z } from 'zod'
import { CREATOR_FILE, DEFAULT_KEYS_DIR, loadOrCreateKeypair, signerFromBase58 } from './keys.ts'
import { createPacedRpc } from './rpc.ts'
import { judgeRenewal, type RenewalSample, renewalVerdictSchema } from './scenarios/renewal.ts'
import { CREATOR, requireFaucetStock, sweep } from './scenarios/us1.ts'
import { createSender } from './send.ts'
import { contribute, type DemoContext, prepare, requestFaucet } from './supporters.ts'

const RENEWAL_FILE = new URL('../../../fixtures/renewal.json', import.meta.url)

const POLL_MS = 1_000
const INDEX_TIMEOUT_MS = 120_000
// Readings kept after the new expiry shows up, so a late flip would still be caught.
const TAIL_SAMPLES = 5
// Not round: a round "5 SUPD" in the logs could pass for a CU count (SC-001).
const FIRST = { units: 4_271_000n, periods: 1 }
const RENEW = { units: 3_519_000n, periods: 1 }

const blankToUndefined = (value: unknown) => (value === '' ? undefined : value)

const env = z
  .object({
    SOLANA_RPC_URL: z.url({ protocol: /^https?$/ }),
    CCS_MINT: addressSchema,
    CCS_KEYS_DIR: z.preprocess(blankToUndefined, z.string().prefault(DEFAULT_KEYS_DIR)),
    FAUCET_SECRET: z.string().min(1),
  })
  .parse(process.env)

const args = z
  .object({
    api: z.url({ protocol: /^https?$/ }).prefault('https://ccsupport-api.onrender.com'),
    rps: z.coerce.number().positive().prefault(8),
  })
  .parse(parseArgs({ options: { api: { type: 'string' }, rps: { type: 'string' } } }).values)

const profileResponse = apiResponseSchema(creatorProfileSchema)
const pledgesResponse = apiResponseSchema(supporterPledgesSchema)
const healthResponse = apiResponseSchema(z.object({ payer: addressSchema }))

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function getJson<T>(url: string, schema: z.ZodType<{ data: T } | ApiErrorBody>): Promise<T> {
  const body = schema.parse(await (await fetch(url)).json())
  if ('error' in body) throw new Error(`${url}: ${body.error.code} ${body.error.message}`)
  return body.data
}

async function main(): Promise<void> {
  const rpc = createPacedRpc(env.SOLANA_RPC_URL, { rps: args.rps, sendRps: 1 })
  const sender = createSender(rpc)
  const faucet = await signerFromBase58(env.FAUCET_SECRET)
  const { signer: creator, created } = await loadOrCreateKeypair(env.CCS_KEYS_DIR, CREATOR_FILE)
  if (created) throw new Error(`${CREATOR_FILE} did not exist: run the demo first`)

  const [{ payer }, { data: mint }, keys, { token }] = await Promise.all([
    getJson(`${args.api}/health`, healthResponse),
    fetchMint(rpc, env.CCS_MINT),
    deriveConfidentialKeys(creator, creator.address, env.CCS_MINT),
    fetchConfidentialAccount(rpc, creator.address, env.CCS_MINT),
  ])
  const ctx: DemoContext = {
    rpc,
    sender,
    api: { baseUrl: args.api, payer },
    mint: env.CCS_MINT,
    decimals: mint.decimals,
    creator: { wallet: creator.address, token, keys },
    faucet,
  }
  await requireFaucetStock(ctx, { supporters: 1, repeats: 1, concurrency: 1, rps: args.rps })

  const supporter = await generateKeyPairSigner()
  const profileUrl = `${args.api}/creators/${CREATOR.handle}`
  const pledgesUrl = `${args.api}/supporters/${supporter.address}/pledges`
  const read = async (): Promise<RenewalSample | null> => {
    const [pledges, profile] = await Promise.all([
      getJson(pledgesUrl, pledgesResponse),
      getJson(profileUrl, profileResponse),
    ])
    const pledge = pledges.find((p) => p.creator === creator.address)
    if (!pledge) return null
    return {
      atMs: performance.now(),
      active: pledge.active,
      expiresAt: pledge.expiresAt,
      activeSupporters: profile.activeSupporters,
    }
  }
  console.log(`api ${args.api}  supporter ${supporter.address}`)

  try {
    const faucetSignature = await requestFaucet(ctx, supporter.address, fetch)
    const supporterKeys = await deriveConfidentialKeys(supporter, supporter.address, ctx.mint)
    const plan = { first: FIRST }
    const prepared = await prepare(ctx, supporter, supporterKeys, plan)
    const first = await contribute(
      ctx,
      supporter,
      supporterKeys,
      FIRST,
      'first',
      fetch,
      performance.now(),
    )
    console.log(`first pledge ${first.transferSignature}`)

    let before: RenewalSample | null = null
    const waitFrom = performance.now()
    while (!before) {
      if (performance.now() - waitFrom > INDEX_TIMEOUT_MS)
        throw new Error('first pledge never indexed')
      await sleep(POLL_MS)
      before = await read()
    }
    console.log(`indexed: expires ${before.expiresAt}, counter ${before.activeSupporters}`)

    const samples: RenewalSample[] = []
    let stop = false
    const sampler = (async () => {
      while (!stop) {
        const sample = await read()
        if (sample) samples.push(sample)
        await sleep(POLL_MS)
      }
    })()

    await sleep(3 * POLL_MS)
    const renewStarted = performance.now()
    const renewal = await contribute(
      ctx,
      supporter,
      supporterKeys,
      RENEW,
      'repeat',
      fetch,
      renewStarted,
    )
    const confirmedAtMs = renewStarted + renewal.confirmedMs
    console.log(`renewal ${renewal.transferSignature}`)

    const expected = Date.parse(before.expiresAt) + RENEW.periods * PERIOD_SECONDS * 1000
    while (performance.now() - confirmedAtMs < INDEX_TIMEOUT_MS) {
      const tail = samples.filter(
        (s) => s.atMs >= confirmedAtMs && Date.parse(s.expiresAt) === expected,
      )
      if (tail.length >= TAIL_SAMPLES) break
      await sleep(POLL_MS)
    }
    stop = true
    await sampler

    const verdict = renewalVerdictSchema.parse(judgeRenewal(before, confirmedAtMs, samples))
    writeFileSync(
      RENEWAL_FILE,
      `${JSON.stringify(
        {
          cluster: 'devnet',
          finishedAt: new Date().toISOString(),
          api: args.api,
          handle: CREATOR.handle,
          supporter: supporter.address,
          signatures: {
            faucet: faucetSignature,
            preparation: prepared.signatures,
            first: first.transferSignature,
            renewal: renewal.transferSignature,
          },
          before: { expiresAt: before.expiresAt, activeSupporters: before.activeSupporters },
          verdict,
        },
        null,
        2,
      )}\n`,
    )
    const sec = (ms: number | null) => (ms === null ? 'never' : `${(ms / 1000).toFixed(1)} s`)
    console.log('\n=== SUMMARY ===')
    console.log(
      `SC-005 renewal before the date: ${verdict.inactive} inactive of ${verdict.samples} readings, counter moved ${verdict.counterMoves}×, new expiry ${verdict.expectedExpiresAt} indexed in ${sec(verdict.indexedMs)} — ${verdict.pass ? 'PASS' : 'FAIL'}`,
    )
    console.log(`→ ${fileURLToPath(RENEWAL_FILE)}`)
  } finally {
    const swept = await sweep(ctx, [supporter])
    console.log(`sweep: ${swept.length} tx`)
  }
}

// exitCode, not exit(): on Node 26 for Windows an exit right after RPC traffic trips a libuv
// assertion and the process ends with 127 instead of the real code.
main().then(
  () => {
    process.exitCode = 0
  },
  (error) => {
    console.error(error)
    process.exitCode = 1
  },
)
