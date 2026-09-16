import { FAUCET_LAMPORTS, FAUCET_UNITS } from '@ccsupport/api/routes/devnet'
import {
  CCSUPPORT_PROGRAM_ADDRESS,
  creatorPda,
  decryptAvailable,
  deriveConfidentialKeys,
  fetchConfidentialAccount,
  fetchMaybeCreator,
  fetchPublicBalance,
  planPreparation,
  registerCreatorInstruction,
} from '@ccsupport/chain'
import {
  type Address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  type KeyPairSigner,
  lamports,
  pipe,
  type Signature,
  setTransactionMessageFeePayerSigner,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'
import {
  findAssociatedTokenPda,
  getTransferInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022'
import { z } from 'zod'
import {
  type ContributionResult,
  contributionPlan,
  type DemoContext,
  percentile,
  requestFaucet,
  runSupporter,
  type SupporterResult,
} from '../supporters.ts'

export const CREATOR = {
  handle: 'marrow-dispatch',
  name: 'The Marrow Dispatch',
  description: 'Independent reporting on municipal budgets and public procurement.',
} as const

// The creator pays for registration, the ATA and apply themselves; the 0.02 SOL faucet portion covers it with room to spare.
const CREATOR_MIN_LAMPORTS = 10_000_000n

const FIRST_BUDGET_MS = 180_000
const REPEAT_BUDGET_MS = 60_000
const DEMO_BUDGET_MS = 30 * 60_000
const SWEEP_BATCH = 6

export type Us1Options = { supporters: number; repeats: number; concurrency: number; rps: number }

const signatureSchema = z.string().min(1)
export const contributionSchema = z.object({
  kind: z.enum(['first', 'repeat']),
  periods: z.number().int(),
  proofSignatures: z.array(signatureSchema),
  transferSignature: signatureSchema,
  closeSignatures: z.array(signatureSchema),
  confirmedMs: z.number(),
  totalMs: z.number(),
  amountTraces: z.array(
    z.object({
      source: z.enum(['transaction', 'logs', 'account']),
      where: z.string(),
      form: z.enum(['u64le', 'decimal', 'ui']),
    }),
  ),
  decryptedMatches: z.boolean(),
})

// No amounts here on purpose: the file is committed, and SC-001 is exactly about them being visible nowhere.
export const demoRunSchema = z.object({
  cluster: z.literal('devnet'),
  startedAt: z.string(),
  finishedAt: z.string(),
  program: z.string(),
  mint: z.string(),
  relayPayer: z.string(),
  creator: z.object({ wallet: z.string(), token: z.string(), handle: z.string() }),
  options: z.object({
    supporters: z.number().int(),
    repeats: z.number().int(),
    concurrency: z.number().int(),
    rps: z.number(),
  }),
  sweepSignatures: z.array(signatureSchema),
  results: z.array(
    z.object({
      index: z.number().int(),
      wallet: z.string(),
      token: z.string(),
      faucetSignature: z.string(),
      preparationSignatures: z.array(signatureSchema),
      contributions: z.array(contributionSchema),
      error: z.string().nullable(),
    }),
  ),
  summary: z.object({
    succeeded: z.number().int(),
    failed: z.number().int(),
    sc001: z.object({ checked: z.number().int(), clean: z.number().int(), pass: z.boolean() }),
    sc003: z.object({
      firstSamples: z.number().int(),
      firstP95Ms: z.number(),
      firstMaxMs: z.number(),
      repeatSamples: z.number().int(),
      repeatP95Ms: z.number(),
      repeatMaxMs: z.number(),
      pass: z.boolean(),
    }),
    sc008: z.object({ totalMs: z.number(), pass: z.boolean() }),
    fr015: z.object({
      decryptedMatched: z.number().int(),
      creatorBalanceMatches: z.boolean(),
      pass: z.boolean(),
    }),
  }),
})

export type DemoRun = z.infer<typeof demoRunSchema>

async function pool<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      const item = items[i]
      if (item !== undefined) results[i] = await run(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

export type CreatorSetup = {
  token: Address
  keys: DemoContext['creator']['keys']
  availableBefore: bigint
  signatures: Signature[]
}

export async function setupCreator(
  ctx: Omit<DemoContext, 'creator'>,
  creator: KeyPairSigner,
): Promise<CreatorSetup> {
  const signatures: Signature[] = []
  const { value: balance } = await ctx.rpc.getBalance(creator.address).send()
  if (balance < CREATOR_MIN_LAMPORTS)
    signatures.push(await requestFaucet(ctx, creator.address, fetch))

  const [pda] = await creatorPda(creator.address)
  const existing = await fetchMaybeCreator(ctx.rpc, pda)
  if (!existing.exists) {
    signatures.push(
      await ctx.sender.sendInstructions(creator, [
        await registerCreatorInstruction({ wallet: creator, ...CREATOR }),
      ]),
    )
  }

  const keys = await deriveConfidentialKeys(creator, creator.address, ctx.mint)
  const { token, account, decimals } = await fetchConfidentialAccount(
    ctx.rpc,
    creator.address,
    ctx.mint,
  )
  const preparation = await planPreparation(account, decimals, {
    rpc: ctx.rpc,
    owner: creator,
    mint: ctx.mint,
    keys,
    units: 0n,
    deposit: 0n,
  })
  for (const step of preparation.steps) {
    signatures.push(await ctx.sender.sendInstructions(creator, step.instructions))
  }
  const settled = await fetchConfidentialAccount(ctx.rpc, creator.address, ctx.mint)
  if (!settled.account) throw new Error('creator token account was not created')
  const available = decryptAvailable(keys.ae(), settled.account)
  if (!available.ok) throw new Error(`creator available balance: ${available.reason}`)
  return { token, keys, availableBefore: available.units, signatures }
}

// FR-015: after all contributions the creator applies pending, and the available
// balance grows by exactly the sum sent — there is no platform fee.
async function creatorReceived(
  ctx: DemoContext,
  creator: KeyPairSigner,
  availableBefore: bigint,
): Promise<bigint> {
  const { account, decimals } = await fetchConfidentialAccount(ctx.rpc, creator.address, ctx.mint)
  const preparation = await planPreparation(account, decimals, {
    rpc: ctx.rpc,
    owner: creator,
    mint: ctx.mint,
    keys: ctx.creator.keys,
    units: 0n,
    deposit: 0n,
  })
  for (const step of preparation.steps) {
    await ctx.sender.sendInstructions(creator, step.instructions)
  }
  const settled = await fetchConfidentialAccount(ctx.rpc, creator.address, ctx.mint)
  if (!settled.account) throw new Error('creator token account disappeared')
  const available = decryptAvailable(ctx.creator.keys.ae(), settled.account)
  if (!available.ok) throw new Error(`creator available balance: ${available.reason}`)
  return available.units - availableBefore
}

// Supporters are ephemeral: SOL and public SUPD return to the faucet in batches, the faucet
// pays the fee. Deposited SUPD cannot be returned without a Withdraw proof — it stays.
export async function sweep(ctx: DemoContext, signers: KeyPairSigner[]): Promise<Signature[]> {
  const tokenProgram = TOKEN_2022_PROGRAM_ADDRESS
  const [faucetToken] = await findAssociatedTokenPda({
    owner: ctx.faucet.address,
    mint: ctx.mint,
    tokenProgram,
  })
  const signatures: Signature[] = []
  for (let i = 0; i < signers.length; i += SWEEP_BATCH) {
    const batch = signers.slice(i, i + SWEEP_BATCH)
    const holdings = await Promise.all(
      batch.map(async (signer) => {
        const [{ value: lamportsHeld }, { token, account }] = await Promise.all([
          ctx.rpc.getBalance(signer.address, { commitment: 'confirmed' }).send(),
          fetchConfidentialAccount(ctx.rpc, signer.address, ctx.mint),
        ])
        return { signer, lamportsHeld, token, units: account?.amount ?? 0n }
      }),
    )
    const instructions = holdings.flatMap(({ signer, lamportsHeld, token, units }) => [
      ...(units > 0n
        ? [
            getTransferInstruction(
              { source: token, destination: faucetToken, authority: signer, amount: units },
              { programAddress: tokenProgram },
            ),
          ]
        : []),
      ...(lamportsHeld > 0n
        ? [
            getTransferSolInstruction({
              source: signer,
              destination: ctx.faucet.address,
              amount: lamports(lamportsHeld),
            }),
          ]
        : []),
    ])
    if (instructions.length === 0) continue
    signatures.push(
      await ctx.sender.send(
        pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayerSigner(ctx.faucet, m),
          (m) => appendTransactionMessageInstructions(instructions, m),
        ),
      ),
    )
  }
  return signatures
}

function summarize(
  results: SupporterResult[],
  totalMs: number,
  creatorBalanceMatches: boolean,
): DemoRun['summary'] {
  const contributions: ContributionResult[] = results.flatMap((r) => r.contributions)
  const firsts = contributions.filter((c) => c.kind === 'first').map((c) => c.confirmedMs)
  const repeats = contributions.filter((c) => c.kind === 'repeat').map((c) => c.confirmedMs)
  const clean = contributions.filter((c) => c.amountTraces.length === 0).length
  const matched = contributions.filter((c) => c.decryptedMatches).length
  const failed = results.filter((r) => r.error !== null).length
  const firstP95Ms = percentile(firsts, 95)
  const repeatP95Ms = percentile(repeats, 95)
  return {
    succeeded: results.length - failed,
    failed,
    sc001: {
      checked: contributions.length,
      clean,
      pass: failed === 0 && clean === contributions.length,
    },
    sc003: {
      firstSamples: firsts.length,
      firstP95Ms,
      firstMaxMs: Math.max(0, ...firsts),
      repeatSamples: repeats.length,
      repeatP95Ms,
      repeatMaxMs: Math.max(0, ...repeats),
      pass: firstP95Ms <= FIRST_BUDGET_MS && repeatP95Ms <= REPEAT_BUDGET_MS,
    },
    sc008: { totalMs, pass: failed === 0 && totalMs <= DEMO_BUDGET_MS },
    fr015: {
      decryptedMatched: matched,
      creatorBalanceMatches,
      pass: matched === contributions.length && creatorBalanceMatches,
    },
  }
}

// Deposited SUPD does not come back from the ephemeral wallets, so every run costs the
// faucet N portions; SOL comes back through the sweep, in flight is concurrency + one batch.
export async function requireFaucetStock(
  ctx: Omit<DemoContext, 'creator'>,
  options: Us1Options,
): Promise<void> {
  const [{ value: lamportsHeld }, units] = await Promise.all([
    ctx.rpc.getBalance(ctx.faucet.address).send(),
    fetchPublicBalance(ctx.rpc, ctx.faucet.address, ctx.mint),
  ])
  const needUnits = FAUCET_UNITS * BigInt(options.supporters + 1)
  const needLamports = FAUCET_LAMPORTS * BigInt(options.concurrency + SWEEP_BATCH + 2)
  if (units < needUnits) {
    throw new Error(
      `faucet holds ${units} SUPD units, the run needs ${needUnits}: pnpm --filter @ccsupport/mint mint mint-to ${ctx.faucet.address} ${needUnits - units}`,
    )
  }
  if (lamportsHeld < needLamports) {
    throw new Error(`faucet holds ${lamportsHeld} lamports, the run needs ${needLamports}`)
  }
}

export async function runUs1(
  base: Omit<DemoContext, 'creator'>,
  creator: KeyPairSigner,
  options: Us1Options,
  log: (line: string) => void,
): Promise<DemoRun> {
  await requireFaucetStock(base, options)
  const startedAt = new Date()
  const started = performance.now()

  const setup = await setupCreator(base, creator)
  log(
    `creator ${creator.address} (${CREATOR.handle}) token ${setup.token}${setup.signatures.length > 0 ? ` — ${setup.signatures.length} setup tx` : ''}`,
  )
  const ctx: DemoContext = {
    ...base,
    creator: { wallet: creator.address, token: setup.token, keys: setup.keys },
  }

  const plans = Array.from({ length: options.supporters }, (_, i) => ({
    index: i,
    plan: contributionPlan(i, options.repeats),
  }))
  let done = 0
  // Sweep as we go, not at the end: otherwise the faucet holds 0.02 SOL × N for the whole run.
  const pendingSweep: KeyPairSigner[] = []
  const sweepSignatures: Signature[] = []
  const sweepBatch = async (all = false) => {
    while (pendingSweep.length >= SWEEP_BATCH || (all && pendingSweep.length > 0)) {
      sweepSignatures.push(...(await sweep(ctx, pendingSweep.splice(0, SWEEP_BATCH))))
    }
  }
  let results: SupporterResult[]
  try {
    results = await pool(plans, options.concurrency, async ({ index, plan }) => {
      const { result, signer } = await runSupporter(ctx, index, plan)
      pendingSweep.push(signer)
      done += 1
      const times = result.contributions
        .map((c) => `${c.kind} ${(c.confirmedMs / 1000).toFixed(1)}s`)
        .join(', ')
      log(
        `[${String(done).padStart(3)}/${options.supporters}] #${index} ${result.wallet} ${result.error ? `FAILED: ${result.error}` : times}`,
      )
      await sweepBatch()
      return result
    })
  } finally {
    await sweepBatch(true)
    log(`sweep: ${sweepSignatures.length} tx`)
  }

  const expected = results
    .flatMap((r, i) => {
      const plan = plans[i]?.plan
      if (!plan) return []
      return r.contributions.map((c) =>
        c.kind === 'first' ? plan.first.units : (plan.repeat?.units ?? 0n),
      )
    })
    .reduce((a, b) => a + b, 0n)
  const received = await creatorReceived(ctx, creator, setup.availableBefore)
  const totalMs = performance.now() - started

  return demoRunSchema.parse({
    cluster: 'devnet',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    program: CCSUPPORT_PROGRAM_ADDRESS,
    mint: base.mint,
    relayPayer: base.api.payer,
    creator: { wallet: creator.address, token: setup.token, handle: CREATOR.handle },
    options,
    sweepSignatures,
    results,
    summary: summarize(results, totalMs, received === expected),
  })
}
