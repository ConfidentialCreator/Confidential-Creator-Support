import {
  buildContribution,
  type ContributionMessage,
  decryptContribution,
  deriveConfidentialKeys,
  extractValidityContext,
  fetchConfidentialAccount,
  planPreparation,
  relayClose,
  relayProofs,
  signForRelay,
} from '@ccsupport/chain'
import { apiResponseSchema, faucetResponseSchema } from '@ccsupport/shared'
import {
  type Address,
  generateKeyPairSigner,
  type KeyPairSigner,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from '@solana/kit'
import type { ConfidentialKeys } from '@solana/zk-sdk'
import type { Sender } from './send.ts'
import { type AmountTrace, verifyNoAmount } from './verify/no-amount.ts'

// The faucet portion (T027): 100 SUPD — the plan for both contributions must fit in it.
export const SUPPORTER_UNITS = 100_000_000n
const ONE = 1_000_000n
const FAUCET_ATTEMPTS = 3
const FAUCET_RETRY_MS = 3_000

export type ContributionEntry = { units: bigint; periods: number }
export type ContributionPlan = { first: ContributionEntry; repeat?: ContributionEntry }

// Amounts are deterministic from the index and never round: a round "5 SUPD" = 5000000
// could be mistaken for a CU count in the logs, and SC-001 would report a false trace.
export function contributionPlan(index: number, repeats: number): ContributionPlan {
  const entry = (salt: number): ContributionEntry => ({
    units:
      ONE * BigInt(3 + ((index * 7 + salt) % 40)) +
      BigInt(10_000 * ((index * 37 + salt) % 99)) +
      1_000n,
    periods: 1 + ((index + salt) % 12),
  })
  const plan: ContributionPlan = { first: entry(0) }
  if (index < repeats) plan.repeat = entry(11)
  return plan
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1] ?? 0
}

export type DemoContext = {
  rpc: Rpc<SolanaRpcApi>
  sender: Sender
  api: { baseUrl: string; payer: Address }
  mint: Address
  decimals: number
  creator: { wallet: Address; token: Address; keys: ConfidentialKeys }
  faucet: KeyPairSigner
}

export type ContributionResult = {
  kind: 'first' | 'repeat'
  periods: number
  proofSignatures: Signature[]
  transferSignature: Signature
  closeSignatures: Signature[]
  // from the start (for a first one, from wallet preparation) to transfer confirmation / to proof close
  confirmedMs: number
  totalMs: number
  amountTraces: AmountTrace[]
  decryptedMatches: boolean
}

export type SupporterResult = {
  index: number
  wallet: Address
  token: Address
  faucetSignature: Signature
  preparationSignatures: Signature[]
  contributions: ContributionResult[]
  error: string | null
}

const faucetSchema = apiResponseSchema(faucetResponseSchema)

// There is no proxy locally, so every supporter arrives with its own address — as in
// reality with 128 wallets; the relay limit of 20/min is then counted per supporter.
export function forwardedFetch(ip: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('x-forwarded-for', ip)
    return fetch(input, { ...init, headers })
  }
}

export async function requestFaucet(
  ctx: Pick<DemoContext, 'api'>,
  wallet: Address,
  fetchImpl: typeof fetch,
  attempt = 1,
): Promise<Signature> {
  const response = await fetchImpl(`${ctx.api.baseUrl}/devnet/faucet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet }),
  })
  const body = faucetSchema.parse(await response.json())
  if ('data' in body) return body.data.signature as Signature
  // The API sends the faucet transaction without pacing; a 429 from the RPC arrives here as INTERNAL.
  if (body.error.code === 'INTERNAL' && attempt < FAUCET_ATTEMPTS) {
    await new Promise((resolve) => setTimeout(resolve, FAUCET_RETRY_MS))
    return requestFaucet(ctx, wallet, fetchImpl, attempt + 1)
  }
  throw new Error(`faucet: ${body.error.code} ${body.error.message}`)
}

export async function prepare(
  ctx: DemoContext,
  supporter: KeyPairSigner,
  keys: ConfidentialKeys,
  plan: ContributionPlan,
): Promise<{ token: Address; signatures: Signature[] }> {
  const { token, account, decimals } = await fetchConfidentialAccount(
    ctx.rpc,
    supporter.address,
    ctx.mint,
  )
  // The whole public balance, as in the product (T022): a deposit of exactly the contribution
  // would reveal it to an outsider even though the transfer is encrypted.
  const preparation = await planPreparation(account, decimals, {
    rpc: ctx.rpc,
    owner: supporter,
    mint: ctx.mint,
    keys,
    units: plan.first.units,
  })
  // Three SDK steps in one transaction: Apply reads pending after Deposit already, and
  // Helius Free lets one `sendTransaction` through per second.
  const signature = await ctx.sender.sendInstructions(
    supporter,
    preparation.steps.flatMap((step) => step.instructions),
  )
  return { token, signatures: [signature] }
}

// One tx per request, blockhash right before signing: in the 1/s `sendTransaction` lane
// a batch of four signed up front would outlive its blockhash.
async function relayBatch(
  messages: ContributionMessage[],
  ctx: DemoContext,
  fetchImpl: typeof fetch,
  send: typeof relayProofs,
): Promise<Signature[]> {
  const signatures: Signature[] = []
  for (const message of messages) {
    const wire = await signForRelay(message, await ctx.sender.latestBlockhash())
    signatures.push(...(await send(ctx.api.baseUrl, [wire], fetchImpl)))
  }
  return signatures
}

export async function contribute(
  ctx: DemoContext,
  supporter: KeyPairSigner,
  keys: ConfidentialKeys,
  entry: ContributionEntry,
  kind: ContributionResult['kind'],
  fetchImpl: typeof fetch,
  startedAt: number,
): Promise<Omit<ContributionResult, 'amountTraces' | 'decryptedMatches'>> {
  const contribution = await buildContribution({
    rpc: ctx.rpc,
    keys,
    supporter,
    creator: ctx.creator.wallet,
    mint: ctx.mint,
    units: entry.units,
    periods: entry.periods,
    showPublicly: true,
    payer: ctx.api.payer,
  })
  const proofSignatures = await relayBatch(contribution.proofs, ctx, fetchImpl, relayProofs)
  const transferSignature = await ctx.sender.send(contribution.transfer)
  const confirmedMs = performance.now() - startedAt
  const closeSignatures = await relayBatch(contribution.close, ctx, fetchImpl, relayClose)
  return {
    kind,
    periods: entry.periods,
    proofSignatures,
    transferSignature,
    closeSignatures,
    confirmedMs,
    totalMs: performance.now() - startedAt,
  }
}

export async function verify(
  ctx: DemoContext,
  sent: Omit<ContributionResult, 'amountTraces' | 'decryptedMatches'>,
  units: bigint,
  supporterToken: Address,
): Promise<ContributionResult> {
  const transfer = await verifyNoAmount(ctx.rpc, {
    signature: sent.transferSignature,
    units,
    decimals: ctx.decimals,
    tokens: [
      { label: 'supporter', address: supporterToken },
      { label: 'creator', address: ctx.creator.token },
    ],
  })
  const proofs = await Promise.all(
    sent.proofSignatures.map((signature) =>
      verifyNoAmount(ctx.rpc, { signature, units, decimals: ctx.decimals, tokens: [] }),
    ),
  )
  const amountTraces = [
    ...transfer.traces,
    ...proofs.flatMap((p, i) =>
      p.traces.map((t) => ({ ...t, where: `proof ${i + 1} ${t.where}` })),
    ),
  ]
  // The creator's ciphertext lives only in the validity context (decision A, T024).
  const context = proofs.map((p) => extractValidityContext(p.wire)).find((c) => c !== null)
  const decrypted = context ? decryptContribution(ctx.creator.keys.elgamal(), context) : null
  return {
    ...sent,
    amountTraces,
    decryptedMatches: decrypted?.ok === true && decrypted.units === units,
  }
}

export async function runSupporter(
  ctx: DemoContext,
  index: number,
  plan: ContributionPlan,
): Promise<{ result: SupporterResult; signer: KeyPairSigner }> {
  const supporter = await generateKeyPairSigner()
  const fetchImpl = forwardedFetch(`10.0.${(index >> 8) & 255}.${index & 255}`)
  const result: SupporterResult = {
    index,
    wallet: supporter.address,
    token: supporter.address,
    faucetSignature: '' as Signature,
    preparationSignatures: [],
    contributions: [],
    error: null,
  }
  try {
    result.faucetSignature = await requestFaucet(ctx, supporter.address, fetchImpl)
    const keys = await deriveConfidentialKeys(supporter, supporter.address, ctx.mint)

    const firstStarted = performance.now()
    const prepared = await prepare(ctx, supporter, keys, plan)
    result.token = prepared.token
    result.preparationSignatures = prepared.signatures
    const first = await contribute(
      ctx,
      supporter,
      keys,
      plan.first,
      'first',
      fetchImpl,
      firstStarted,
    )
    result.contributions.push(await verify(ctx, first, plan.first.units, prepared.token))

    if (plan.repeat) {
      const repeat = await contribute(
        ctx,
        supporter,
        keys,
        plan.repeat,
        'repeat',
        fetchImpl,
        performance.now(),
      )
      result.contributions.push(await verify(ctx, repeat, plan.repeat.units, prepared.token))
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }
  return { result, signer: supporter }
}
