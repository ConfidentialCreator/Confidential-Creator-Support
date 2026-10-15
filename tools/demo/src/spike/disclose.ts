// Spike S3 (T046): can a supporter disclose the amount of one contribution with a proof a
// stranger checks against the chain without any of the supporter's keys?
//
// Construction under test: the supporter takes the source ciphertext of the transfer
// (lo + hi·2¹⁶ from the validity proof context), builds `x·G` — a Pedersen commitment to
// the amount with the zero opening, so the stranger rebuilds it from the bare number — and
// proves with `CiphertextCommitmentEqualityProofData` that both carry the same amount.
// The stranger trusts nothing in the payload but the proof itself: the ciphertext comes
// from the validity proof transaction (re-verified offline), and its commitment must equal
// the one Token-2022 accepted in the Transfer (the auditor ciphertext in its data).
//
// Run: pnpm --filter @ccsupport/demo spike:disclose [--live]
//   offline — the S1 devnet transactions in `fixtures/tx/` (known keys and amount);
//   --live  — the same signatures fetched from `SOLANA_RPC_URL`, plus a foreign transfer
//             from `fixtures/demo-run.json` as the "other contribution".
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { ristretto255 } from '@noble/curves/ed25519.js'
import {
  type Address,
  createSolanaRpc,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Signature,
} from '@solana/kit'
import {
  BatchedGroupedCiphertext3HandlesValidityProofData,
  CiphertextCommitmentEqualityProofData,
  ElGamalCiphertext,
  ElGamalKeypair,
  ElGamalSecretKey,
  PedersenCommitment,
  PedersenOpening,
} from '@solana/zk-sdk'
import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  getConfidentialTransferInstructionDataDecoder,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022'
import { z } from 'zod'
import { FIXTURE_DIR, txFixtureSchema } from './fixture.ts'

const ZK_ELGAMAL_PROOF = 'ZkE1Gama1Proof11111111111111111111111111111'
const VERIFY_GROUPED_3_VALIDITY = 12
// Transfer accounts with every optional present: source, mint, destination, sysvar,
// equality, validity, range, authority.
const TRANSFER_VALIDITY_ACCOUNT = 4
const VERIFY_CONTEXT_ACCOUNT = 0

const POINT = 32
const GROUPED = 4 * POINT
const VALIDITY_CONTEXT = 3 * POINT + 2 * GROUPED
const EQUALITY_CONTEXT = POINT + 2 * POINT + POINT
const SIGNATURE = 64
const PAYLOAD_VERSION = 1
const LO_BITS = 16n
const HANDLE_SOURCE = 0

const { Point } = ristretto255

// ── chain reading ─────────────────────────────────────────────────────────────

function compiled(wire: string) {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
  if (!('instructions' in message)) throw new Error('legacy-less message without instructions')
  return message
}

type TransferFacts = {
  validityAccount: Address
  commitmentLo: Uint8Array
  commitmentHi: Uint8Array
}

function readTransfer(wire: string): TransferFacts {
  const message = compiled(wire)
  const ix = message.instructions.find(
    (i) =>
      message.staticAccounts[i.programAddressIndex] === TOKEN_2022_PROGRAM_ADDRESS &&
      i.data?.[0] === CONFIDENTIAL_TRANSFER_DISCRIMINATOR &&
      i.data[1] === CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  )
  const index = ix?.accountIndices?.[TRANSFER_VALIDITY_ACCOUNT]
  const validityAccount = index === undefined ? undefined : message.staticAccounts[index]
  if (!ix?.data || !validityAccount) throw new Error('no confidential Transfer in the transaction')
  const data = getConfidentialTransferInstructionDataDecoder().decode(ix.data)
  // An auditor ciphertext is commitment ‖ handle; the commitment is shared by all handles.
  return {
    validityAccount,
    commitmentLo: new Uint8Array(data.transferAmountAuditorCiphertextLo).slice(0, POINT),
    commitmentHi: new Uint8Array(data.transferAmountAuditorCiphertextHi).slice(0, POINT),
  }
}

type ValidityFacts = { account: Address; proof: BatchedGroupedCiphertext3HandlesValidityProofData }

function readValidity(wire: string): ValidityFacts {
  const message = compiled(wire)
  const ix = message.instructions.find(
    (i) =>
      message.staticAccounts[i.programAddressIndex] === ZK_ELGAMAL_PROOF &&
      i.data?.[0] === VERIFY_GROUPED_3_VALIDITY,
  )
  const index = ix?.accountIndices?.[VERIFY_CONTEXT_ACCOUNT]
  const account = index === undefined ? undefined : message.staticAccounts[index]
  if (!ix?.data || !account) throw new Error('no inline validity proof in the transaction')
  return {
    account,
    proof: BatchedGroupedCiphertext3HandlesValidityProofData.fromBytes(ix.data.slice(1)),
  }
}

// pubkeys (source, destination, auditor) ‖ grouped lo ‖ grouped hi.
function splitValidityContext(context: Uint8Array) {
  if (context.length !== VALIDITY_CONTEXT) throw new Error('validity context size')
  const at = 3 * POINT
  return {
    sourcePubkey: context.slice(0, POINT),
    groupedLo: context.slice(at, at + GROUPED),
    groupedHi: context.slice(at + GROUPED, at + 2 * GROUPED),
  }
}

function sourceCiphertext(groupedLo: Uint8Array, groupedHi: Uint8Array): Uint8Array {
  const handleAt = POINT * (1 + HANDLE_SOURCE)
  const part = (g: Uint8Array) => ({
    c: Point.fromBytes(g.slice(0, POINT)),
    d: Point.fromBytes(g.slice(handleAt, handleAt + POINT)),
  })
  const lo = part(groupedLo)
  const hi = part(groupedHi)
  const scale = 1n << LO_BITS
  const out = new Uint8Array(2 * POINT)
  out.set(lo.c.add(hi.c.multiply(scale)).toBytes(), 0)
  out.set(lo.d.add(hi.d.multiply(scale)).toBytes(), POINT)
  return out
}

const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i])

// ── payload ───────────────────────────────────────────────────────────────────

export type Disclosure = {
  transferSig: string
  proofSig: string
  amount: bigint
  proof: Uint8Array // the equality proof without its context — the verifier rebuilds it
}

function encodePayload(d: Disclosure): string {
  const b58 = getBase58Encoder()
  const proofPart = d.proof
  const out = new Uint8Array(1 + 2 * SIGNATURE + 8 + proofPart.length)
  out[0] = PAYLOAD_VERSION
  out.set(b58.encode(d.transferSig), 1)
  out.set(b58.encode(d.proofSig), 1 + SIGNATURE)
  new DataView(out.buffer).setBigUint64(1 + 2 * SIGNATURE, d.amount, true)
  out.set(proofPart, 1 + 2 * SIGNATURE + 8)
  return Buffer.from(out).toString('base64url')
}

function decodePayload(text: string): Disclosure {
  const bytes = new Uint8Array(Buffer.from(text, 'base64url'))
  if (bytes[0] !== PAYLOAD_VERSION) throw new Error('payload version')
  const b58 = getBase58Decoder()
  return {
    transferSig: b58.decode(bytes.slice(1, 1 + SIGNATURE)),
    proofSig: b58.decode(bytes.slice(1 + SIGNATURE, 1 + 2 * SIGNATURE)),
    amount: new DataView(bytes.buffer).getBigUint64(1 + 2 * SIGNATURE, true),
    proof: bytes.slice(1 + 2 * SIGNATURE + 8),
  }
}

// ── prover (the supporter, holds the ElGamal secret) ──────────────────────────

function disclose(
  elgamal: ElGamalKeypair,
  transferSig: string,
  proofSig: string,
  proofWire: string,
  claimed?: bigint,
): Disclosure {
  const context = splitValidityContext(readValidity(proofWire).proof.context().toBytes())
  const ciphertext = ElGamalCiphertext.fromBytes(
    sourceCiphertext(context.groupedLo, context.groupedHi),
  )
  if (!ciphertext) throw new Error('source ciphertext does not parse')
  const amount = claimed ?? elgamal.secret().decrypt(ciphertext)
  const zero = PedersenOpening.zero()
  const commitment = PedersenCommitment.from(amount, zero)
  const proof = new CiphertextCommitmentEqualityProofData(
    elgamal,
    ciphertext,
    commitment,
    zero,
    amount,
  )
  return { transferSig, proofSig, amount, proof: proof.toBytes().slice(EQUALITY_CONTEXT) }
}

// ── verifier (a stranger, no keys) ────────────────────────────────────────────

type Verdict = { ok: true; amount: bigint } | { ok: false; reason: string }

function verify(d: Disclosure, transferWire: string, proofWire: string): Verdict {
  let transfer: TransferFacts
  let validity: ValidityFacts
  try {
    transfer = readTransfer(transferWire)
    validity = readValidity(proofWire)
  } catch (err) {
    return { ok: false, reason: `unreadable: ${(err as Error).message}` }
  }
  if (validity.account !== transfer.validityAccount) {
    return { ok: false, reason: 'proof transaction did not write the Transfer’s validity account' }
  }
  try {
    validity.proof.verify()
  } catch {
    return { ok: false, reason: 'validity proof does not verify' }
  }
  const context = splitValidityContext(validity.proof.context().toBytes())
  if (
    !equal(context.groupedLo.slice(0, POINT), transfer.commitmentLo) ||
    !equal(context.groupedHi.slice(0, POINT), transfer.commitmentHi)
  ) {
    return { ok: false, reason: 'ciphertext is not the one this Transfer moved' }
  }
  const commitment = PedersenCommitment.from(d.amount, PedersenOpening.zero()).toBytes()
  const full = new Uint8Array(EQUALITY_CONTEXT + d.proof.length)
  full.set(context.sourcePubkey, 0)
  full.set(sourceCiphertext(context.groupedLo, context.groupedHi), POINT)
  full.set(commitment, 3 * POINT)
  full.set(d.proof, EQUALITY_CONTEXT)
  try {
    CiphertextCommitmentEqualityProofData.fromBytes(full).verify()
  } catch {
    return { ok: false, reason: 'equality proof does not verify for this amount' }
  }
  return { ok: true, amount: d.amount }
}

// ── run ───────────────────────────────────────────────────────────────────────

const { values } = parseArgs({ options: { live: { type: 'boolean', default: false } } })

const fixture = (name: string) =>
  txFixtureSchema.parse(JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_DIR), 'utf8')))
const transferFx = fixture('transfer')
const proofFx = ['proof-1', 'proof-2', 'proof-3', 'proof-4'].map(fixture).find((f) => {
  try {
    readValidity(f.wire)
    return true
  } catch {
    return false
  }
})
if (!proofFx) throw new Error('no validity proof among fixtures')

const hexBytes = (h: string) => new Uint8Array(Buffer.from(h, 'hex'))
const supporter = ElGamalKeypair.fromSecretKey(
  ElGamalSecretKey.fromBytes(hexBytes(transferFx.context.keys.supporterElgamalSecret)),
)
const expected = BigInt(transferFx.context.amount)

let failures = 0
function check(label: string, pass: boolean, detail: string) {
  if (!pass) failures++
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label.padEnd(52)} ${detail}`)
}
const show = (v: Verdict) => (v.ok ? `amount ${v.amount}` : `refused: ${v.reason}`)

console.log(`S1 transfer ${transferFx.signature.slice(0, 12)}…, validity in ${proofFx.label}\n`)

const t0 = performance.now()
const disclosure = disclose(supporter, transferFx.signature, proofFx.signature, proofFx.wire)
const proveMs = performance.now() - t0
const payload = encodePayload(disclosure)
console.log(
  `prove ${proveMs.toFixed(1)} ms; equality proof ${disclosure.proof.length} B; payload ${payload.length} chars (base64url)\n`,
)

const decoded = decodePayload(payload)
const t1 = performance.now()
const honest = verify(decoded, transferFx.wire, proofFx.wire)
const verifyMs = performance.now() - t1
check(
  'honest payload → the amount',
  honest.ok && honest.amount === expected,
  `${show(honest)} (${verifyMs.toFixed(1)} ms offline)`,
)

const inflated = verify({ ...decoded, amount: decoded.amount + 1n }, transferFx.wire, proofFx.wire)
check('amount + 1 in the payload → refused', !inflated.ok, show(inflated))

// The supporter holds the key and tries to prove a different amount from scratch.
let lie: Verdict
try {
  lie = verify(
    disclose(supporter, transferFx.signature, proofFx.signature, proofFx.wire, expected * 2n),
    transferFx.wire,
    proofFx.wire,
  )
} catch (err) {
  lie = { ok: false, reason: `prover refused: ${String(err)}` }
}
check('prover with the key proves 2× amount → refused', !lie.ok, show(lie))

const tampered = new Uint8Array(decoded.proof)
tampered[0] = (tampered[0] ?? 0) ^ 1
const flipped = verify({ ...decoded, proof: tampered }, transferFx.wire, proofFx.wire)
check('one bit of the proof flipped → refused', !flipped.ok, show(flipped))

const otherProof = ['proof-1', 'proof-2', 'proof-3', 'proof-4']
  .map(fixture)
  .find((f) => f !== proofFx)
if (otherProof) {
  const wrongTx = verify(decoded, transferFx.wire, otherProof.wire)
  check('payload pointed at a non-validity proof tx → refused', !wrongTx.ok, show(wrongTx))
}

const stranger = ElGamalKeypair.fromSeed(new Uint8Array(32).fill(7))
let strangerTry: Verdict
try {
  strangerTry = verify(
    disclose(stranger, transferFx.signature, proofFx.signature, proofFx.wire, expected),
    transferFx.wire,
    proofFx.wire,
  )
} catch (err) {
  strangerTry = { ok: false, reason: `prover refused: ${String(err)}` }
}
check('someone else’s key claims the true amount → refused', !strangerTry.ok, show(strangerTry))

if (values.live) {
  const url = z.string().url().parse(process.env.SOLANA_RPC_URL)
  const rpc = createSolanaRpc(url)
  const wireOf = async (sig: string) => {
    const tx = await rpc
      .getTransaction(sig as Signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
        encoding: 'base64',
      })
      .send()
    if (tx === null) throw new Error(`${sig} not served`)
    if (tx.meta?.err) throw new Error(`${sig} failed on chain`)
    return tx.transaction[0]
  }
  console.log('\n— live (devnet)')
  const t2 = performance.now()
  const [liveTransfer, liveProof] = await Promise.all([
    wireOf(decoded.transferSig),
    wireOf(decoded.proofSig),
  ])
  const live = verify(decoded, liveTransfer, liveProof)
  const liveMs = performance.now() - t2
  check(
    'stranger: two getTransaction + verify',
    live.ok && live.amount === expected,
    `${show(live)} (${liveMs.toFixed(0)} ms, SC-006 ≤ 5000)`,
  )

  const run = z
    .object({
      results: z.array(
        z.object({
          contributions: z.array(
            z.object({ transferSignature: z.string(), proofSignatures: z.array(z.string()) }),
          ),
        }),
      ),
    })
    .parse(
      JSON.parse(
        readFileSync(new URL('../../../../fixtures/demo-run.json', import.meta.url), 'utf8'),
      ),
    )
  const other = run.results.find((r) => r.contributions.length > 1)?.contributions[1]
  if (other) {
    const otherTransfer = await wireOf(other.transferSignature)
    const asIs = verify(decoded, otherTransfer, liveProof)
    check('payload against another Transfer → refused', !asIs.ok, show(asIs))
    const proofWires = await Promise.all(other.proofSignatures.map(wireOf))
    const otherValidity = proofWires.find((w) => {
      try {
        readValidity(w)
        return true
      } catch {
        return false
      }
    })
    if (otherValidity) {
      const swapped = verify(decoded, otherTransfer, otherValidity)
      check('…with its own validity tx → refused', !swapped.ok, show(swapped))
    }
  }
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`)
if (failures > 0) process.exitCode = 1
