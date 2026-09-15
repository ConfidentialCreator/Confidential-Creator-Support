import { deriveConfidentialKeys } from '@ccsupport/chain'
import { generateKeyPairSigner, type KeyPairSigner, type Signature } from '@solana/kit'
import { z } from 'zod'
import { contributionSchema, type DemoRun } from './scenarios/us1.ts'
import {
  type ContributionPlan,
  type ContributionResult,
  contribute,
  type DemoContext,
  forwardedFetch,
  percentile,
  prepare,
  requestFaucet,
  type SupporterResult,
  verify,
} from './supporters.ts'

const SC002_BUDGET_MS = 30_000
const FIRST_BUDGET_MS = 180_000
const REPEAT_BUDGET_MS = 60_000
const FIRST_SIGNATURES_MAX = 6
const REPEAT_SIGNATURES_MAX = 2

export type SignatureCounts = { transactions: number; messages: number }

// One call = one wallet confirmation: kit signs each transaction with one
// `signTransactions` call per signer, and the key derivation is one message.
export function countingSigner(inner: KeyPairSigner): {
  signer: KeyPairSigner
  counts: SignatureCounts
} {
  const counts: SignatureCounts = { transactions: 0, messages: 0 }
  const signer: KeyPairSigner = {
    address: inner.address,
    keyPair: inner.keyPair,
    signMessages: (messages, config) => {
      counts.messages += 1
      return inner.signMessages(messages, config)
    },
    signTransactions: (transactions, config) => {
      counts.transactions += 1
      return inner.signTransactions(transactions, config)
    },
  }
  return { signer, counts }
}

export type Watch = { ms: number; polls: number }
export type WatchOptions = {
  intervalMs: number
  timeoutMs: number
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export async function awaitIndexed(
  read: () => Promise<boolean>,
  options: WatchOptions,
): Promise<Watch | null> {
  const started = options.now()
  let polls = 0
  for (;;) {
    polls += 1
    if (await read()) return { ms: options.now() - started, polls }
    if (options.now() - started + options.intervalMs > options.timeoutMs) return null
    await options.sleep(options.intervalMs)
  }
}

export type Counter = { before: number; after: number; ms: number; polls: number }

export type ProbeContribution = ContributionResult & {
  signatures: SignatureCounts
  // SC-002: from the transfer confirmation until the public counter moved; first only
  counter: Counter | null
  // from the transfer confirmation until the row is on the contributions page
  indexed: Watch | null
}

export type Probe = Omit<SupporterResult, 'contributions'> & { contributions: ProbeContribution[] }

export type Index = {
  activeSupporters(): Promise<number>
  hasContribution(signature: Signature): Promise<boolean>
}

const diff = (now: SignatureCounts, since: SignatureCounts): SignatureCounts => ({
  transactions: now.transactions - since.transactions,
  messages: now.messages - since.messages,
})

export async function runProbe(
  ctx: DemoContext,
  index: number,
  plan: Required<ContributionPlan>,
  idx: Index,
  watch: WatchOptions,
): Promise<{ probe: Probe; signer: KeyPairSigner }> {
  const counted = countingSigner(await generateKeyPairSigner())
  const supporter = counted.signer
  const fetchImpl = forwardedFetch(`10.1.${(index >> 8) & 255}.${index & 255}`)
  const probe: Probe = {
    index,
    wallet: supporter.address,
    token: supporter.address,
    faucetSignature: '' as Signature,
    preparationSignatures: [],
    contributions: [],
    error: null,
  }
  try {
    probe.faucetSignature = await requestFaucet(ctx, supporter.address, fetchImpl)
    const before = await idx.activeSupporters()
    let since = { ...counted.counts }
    const keys = await deriveConfidentialKeys(supporter, supporter.address, ctx.mint)

    const firstStarted = watch.now()
    const prepared = await prepare(ctx, supporter, keys, plan)
    probe.token = prepared.token
    probe.preparationSignatures = prepared.signatures
    const first = await contribute(
      ctx,
      supporter,
      keys,
      plan.first,
      'first',
      fetchImpl,
      firstStarted,
    )
    const signatures = diff(counted.counts, since)
    since = { ...counted.counts }
    // `contribute` closes the proof contexts before returning; the index raced with it.
    const sinceConfirmed = watch.now() - (firstStarted + first.confirmedMs)
    const moved = await awaitIndexed(async () => (await idx.activeSupporters()) > before, watch)
    const indexed = await awaitIndexed(() => idx.hasContribution(first.transferSignature), watch)
    probe.contributions.push({
      ...(await verify(ctx, first, plan.first.units, prepared.token)),
      signatures,
      counter: moved
        ? { before, after: before + 1, ms: sinceConfirmed + moved.ms, polls: moved.polls }
        : null,
      indexed: indexed ? { ...indexed, ms: sinceConfirmed + indexed.ms } : null,
    })

    const repeatStarted = watch.now()
    const repeat = await contribute(
      ctx,
      supporter,
      keys,
      plan.repeat,
      'repeat',
      fetchImpl,
      repeatStarted,
    )
    const repeatSignatures = diff(counted.counts, since)
    const repeatSinceConfirmed = watch.now() - (repeatStarted + repeat.confirmedMs)
    const repeatIndexed = await awaitIndexed(
      () => idx.hasContribution(repeat.transferSignature),
      watch,
    )
    probe.contributions.push({
      ...(await verify(ctx, repeat, plan.repeat.units, prepared.token)),
      signatures: repeatSignatures,
      counter: null,
      indexed: repeatIndexed
        ? { ...repeatIndexed, ms: repeatSinceConfirmed + repeatIndexed.ms }
        : null,
    })
  } catch (err) {
    probe.error = err instanceof Error ? err.message : String(err)
  }
  return { probe, signer: supporter }
}

const watchSchema = z.object({ ms: z.number(), polls: z.number().int() })

const timingSchema = z.object({
  samples: z.number().int(),
  p95Ms: z.number(),
  maxMs: z.number(),
  signaturesMax: z.number().int(),
})

export const measureSchema = z.object({
  cluster: z.literal('devnet'),
  startedAt: z.string(),
  finishedAt: z.string(),
  api: z.string(),
  handle: z.string(),
  probes: z.array(
    z.object({
      index: z.number().int(),
      wallet: z.string(),
      token: z.string(),
      faucetSignature: z.string(),
      preparationSignatures: z.array(z.string()),
      contributions: z.array(
        contributionSchema.extend({
          signatures: z.object({ transactions: z.number().int(), messages: z.number().int() }),
          counter: watchSchema
            .extend({ before: z.number().int(), after: z.number().int() })
            .nullable(),
          indexed: watchSchema.nullable(),
        }),
      ),
      error: z.string().nullable(),
    }),
  ),
  summary: z.object({
    failed: z.number().int(),
    sc001: z.object({ checked: z.number().int(), clean: z.number().int(), pass: z.boolean() }),
    sc002: z.object({ samples: z.number().int(), maxMs: z.number(), pass: z.boolean() }),
    sc003: z.object({
      first: timingSchema,
      repeat: timingSchema,
      cliP95Ms: z.object({ first: z.number(), repeat: z.number() }),
      pass: z.boolean(),
    }),
    sc008: z.object({ totalMs: z.number(), pass: z.boolean() }),
  }),
})

export type Measure = z.infer<typeof measureSchema>

function timing(contributions: ProbeContribution[]) {
  const confirmed = contributions.map((c) => c.confirmedMs)
  return {
    samples: contributions.length,
    p95Ms: percentile(confirmed, 95),
    maxMs: Math.max(0, ...confirmed),
    signaturesMax: Math.max(
      0,
      ...contributions.map((c) => c.signatures.transactions + c.signatures.messages),
    ),
  }
}

// SC-008 and the CLI p95 come from the 128-supporter run: a handful of probes
// measures the index and the wallet, not the throughput.
export function summarizeMeasure(probes: Probe[], run: DemoRun): Measure['summary'] {
  const failed = probes.filter((p) => p.error !== null).length
  const contributions = probes.flatMap((p) => p.contributions)
  const firsts = contributions.filter((c) => c.kind === 'first')
  const repeats = contributions.filter((c) => c.kind === 'repeat')
  const counters = firsts.flatMap((c) => (c.counter ? [c.counter.ms] : []))
  const clean = contributions.filter((c) => c.amountTraces.length === 0).length
  const first = timing(firsts)
  const repeat = timing(repeats)
  const sc002MaxMs = Math.max(0, ...counters)
  return {
    failed,
    sc001: {
      checked: contributions.length,
      clean,
      pass: failed === 0 && clean === contributions.length,
    },
    sc002: {
      samples: counters.length,
      maxMs: sc002MaxMs,
      pass:
        failed === 0 &&
        counters.length > 0 &&
        counters.length === firsts.length &&
        sc002MaxMs <= SC002_BUDGET_MS,
    },
    sc003: {
      first,
      repeat,
      cliP95Ms: { first: run.summary.sc003.firstP95Ms, repeat: run.summary.sc003.repeatP95Ms },
      pass:
        first.p95Ms <= FIRST_BUDGET_MS &&
        first.signaturesMax <= FIRST_SIGNATURES_MAX &&
        repeat.p95Ms <= REPEAT_BUDGET_MS &&
        repeat.signaturesMax <= REPEAT_SIGNATURES_MAX,
    },
    sc008: run.summary.sc008,
  }
}
