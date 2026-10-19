import {
  type Address,
  type GetTransactionApi,
  getBase58Decoder,
  getBase58Encoder,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Rpc,
  type Signature,
  signature,
} from '@solana/kit'
import {
  BatchedGroupedCiphertext3HandlesValidityProofData,
  CiphertextCommitmentEqualityProofData,
  type ElGamalKeypair,
  PedersenCommitment,
  PedersenOpening,
} from '@solana/zk-sdk'
import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  getConfidentialTransferInstructionDataDecoder,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022'
import {
  ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  ZkElGamalProofInstruction,
} from '@solana-program/zk-elgamal-proof'
import { z } from 'zod'
import {
  combineCiphertext,
  decryptContribution,
  extractValidityContext,
  HANDLE,
  type ValidityContext,
} from './decrypt.ts'

export type DisclosedContribution = {
  transferSignature: Signature
  proofSignature: Signature
  proofWire: string
}

export type CreateDisclosureResult =
  | { ok: true; payload: string; units: bigint }
  | { ok: false; reason: 'wrong-key' | 'malformed' }

export type VerifyDisclosureFailure =
  | 'malformed-payload'
  | 'not-found'
  | 'failed-on-chain'
  | 'not-a-transfer'
  | 'wrong-proof-transaction'
  | 'invalid-validity-proof'
  | 'ciphertext-mismatch'
  | 'proof-mismatch'

export type VerifyDisclosureResult =
  | { ok: true; units: bigint; transferSignature: Signature }
  | { ok: false; reason: VerifyDisclosureFailure }

const POINT_BYTES = 32
const GROUPED_BYTES = 4 * POINT_BYTES
const VALIDITY_CONTEXT_BYTES = 3 * POINT_BYTES + 2 * GROUPED_BYTES
// pubkey ‖ ciphertext ‖ commitment
const EQUALITY_CONTEXT_BYTES = 4 * POINT_BYTES
const EQUALITY_PROOF_BYTES = 192
const SIGNATURE_BYTES = 64
const PAYLOAD_VERSION = 1
const AMOUNT_AT = 1 + 2 * SIGNATURE_BYTES
const PROOF_AT = AMOUNT_AT + 8
const PAYLOAD_BYTES = PROOF_AT + EQUALITY_PROOF_BYTES
const payloadSchema = z
  .string()
  .regex(new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((PAYLOAD_BYTES * 4) / 3)}}$`))

// Transfer accounts with every optional one present: source, mint, destination,
// instructions sysvar, equality, validity, range, authority.
const TRANSFER_VALIDITY_ACCOUNT = 4
const VERIFY_CONTEXT_ACCOUNT = 0

function compiledMessage(wire: string) {
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
  return 'instructions' in message ? message : null
}

type TransferFacts = {
  validityAccount: Address
  commitmentLo: Uint8Array
  commitmentHi: Uint8Array
}

function readTransfer(wire: string): TransferFacts | null {
  const message = compiledMessage(wire)
  const ix = message?.instructions.find(
    (i) =>
      message.staticAccounts[i.programAddressIndex] === TOKEN_2022_PROGRAM_ADDRESS &&
      i.data?.[0] === CONFIDENTIAL_TRANSFER_DISCRIMINATOR &&
      i.data[1] === CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  )
  const index = ix?.accountIndices?.[TRANSFER_VALIDITY_ACCOUNT]
  const validityAccount = index === undefined ? undefined : message?.staticAccounts[index]
  if (!ix?.data || !validityAccount) return null
  const data = getConfidentialTransferInstructionDataDecoder().decode(ix.data)
  // Token-2022 checked these against the validity proof on chain; the commitment part
  // is shared by every handle, so it pins the amount the Transfer moved.
  return {
    validityAccount,
    commitmentLo: new Uint8Array(data.transferAmountAuditorCiphertextLo).slice(0, POINT_BYTES),
    commitmentHi: new Uint8Array(data.transferAmountAuditorCiphertextHi).slice(0, POINT_BYTES),
  }
}

type ValidityFacts = { account: Address; proof: BatchedGroupedCiphertext3HandlesValidityProofData }

function readValidity(wire: string): ValidityFacts | null {
  const message = compiledMessage(wire)
  const ix = message?.instructions.find(
    (i) =>
      message.staticAccounts[i.programAddressIndex] === ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS &&
      i.data?.[0] === ZkElGamalProofInstruction.VerifyBatchedGroupedCiphertext3HandlesValidity,
  )
  const index = ix?.accountIndices?.[VERIFY_CONTEXT_ACCOUNT]
  const account = index === undefined ? undefined : message?.staticAccounts[index]
  if (!ix?.data || !account) return null
  return {
    account,
    proof: BatchedGroupedCiphertext3HandlesValidityProofData.fromBytes(ix.data.slice(1)),
  }
}

const toBase64Url = (bytes: Uint8Array) =>
  getBase64Decoder().decode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const fromBase64Url = (text: string) =>
  new Uint8Array(
    getBase64Encoder().encode(
      text
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(text.length / 4) * 4, '='),
    ),
  )

// The commitment opens with zero: the amount is disclosed anyway, and a stranger
// rebuilds the commitment from the bare number with nothing else in the payload.
const commitmentTo = (units: bigint) => PedersenCommitment.from(units, PedersenOpening.zero())

export function createDisclosure(
  elgamal: ElGamalKeypair,
  contribution: DisclosedContribution,
): CreateDisclosureResult {
  let context: ValidityContext | null
  try {
    context = extractValidityContext(contribution.proofWire)
  } catch {
    context = null
  }
  if (context === null) return { ok: false, reason: 'malformed' }
  const decrypted = decryptContribution(elgamal, context, HANDLE.source)
  if (!decrypted.ok) {
    return { ok: false, reason: decrypted.reason === 'wrong-key' ? 'wrong-key' : 'malformed' }
  }
  const { units } = decrypted
  const proof = new CiphertextCommitmentEqualityProofData(
    elgamal,
    combineCiphertext(context, HANDLE.source),
    commitmentTo(units),
    PedersenOpening.zero(),
    units,
  ).toBytes()

  // The proof travels without its context: the verifier rebuilds the context from the
  // chain, so there is no ciphertext or pubkey in the payload to substitute.
  const bytes = new Uint8Array(PAYLOAD_BYTES)
  bytes[0] = PAYLOAD_VERSION
  bytes.set(getBase58Encoder().encode(contribution.transferSignature), 1)
  bytes.set(getBase58Encoder().encode(contribution.proofSignature), 1 + SIGNATURE_BYTES)
  new DataView(bytes.buffer).setBigUint64(AMOUNT_AT, units, true)
  bytes.set(proof.slice(EQUALITY_CONTEXT_BYTES), PROOF_AT)
  return { ok: true, payload: toBase64Url(bytes), units }
}

type Fetched = { ok: true; wire: string } | { ok: false; reason: 'not-found' | 'failed-on-chain' }

async function fetchWire(rpc: Rpc<GetTransactionApi>, sig: Signature): Promise<Fetched> {
  const tx = await rpc
    .getTransaction(sig, {
      commitment: 'confirmed',
      encoding: 'base64',
      maxSupportedTransactionVersion: 0,
    })
    .send()
  if (tx === null) return { ok: false, reason: 'not-found' }
  if (tx.meta?.err) return { ok: false, reason: 'failed-on-chain' }
  return { ok: true, wire: tx.transaction[0] }
}

const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i])

const refuse = (reason: VerifyDisclosureFailure): VerifyDisclosureResult => ({ ok: false, reason })

// Nothing in the payload but the amount and the proof is trusted: the ciphertext comes
// from the validity proof re-verified offline, and its commitments must be the ones the
// Transfer carried. The supporter holds the key of the validity account and can recreate
// it with another ciphertext, so the account's history is not evidence; the Transfer is.
export async function verifyDisclosure(
  payload: string,
  rpc: Rpc<GetTransactionApi>,
): Promise<VerifyDisclosureResult> {
  if (!payloadSchema.safeParse(payload).success) return refuse('malformed-payload')
  const bytes = fromBase64Url(payload)
  if (bytes.length !== PAYLOAD_BYTES || bytes[0] !== PAYLOAD_VERSION) {
    return refuse('malformed-payload')
  }
  const base58 = getBase58Decoder()
  const transferSignature = signature(base58.decode(bytes.slice(1, 1 + SIGNATURE_BYTES)))
  const proofSignature = signature(base58.decode(bytes.slice(1 + SIGNATURE_BYTES, AMOUNT_AT)))
  const units = new DataView(bytes.buffer).getBigUint64(AMOUNT_AT, true)

  const [transferTx, proofTx] = await Promise.all([
    fetchWire(rpc, transferSignature),
    fetchWire(rpc, proofSignature),
  ])
  if (!transferTx.ok) return refuse(transferTx.reason)
  if (!proofTx.ok) return refuse(proofTx.reason)

  const transfer = readTransfer(transferTx.wire)
  if (transfer === null) return refuse('not-a-transfer')
  let validity: ValidityFacts | null
  try {
    validity = readValidity(proofTx.wire)
  } catch {
    validity = null
  }
  if (validity === null || validity.account !== transfer.validityAccount) {
    return refuse('wrong-proof-transaction')
  }
  try {
    validity.proof.verify()
  } catch {
    return refuse('invalid-validity-proof')
  }
  const context = validity.proof.context().toBytes()
  if (context.length !== VALIDITY_CONTEXT_BYTES) return refuse('invalid-validity-proof')
  const loAt = 3 * POINT_BYTES
  const grouped: ValidityContext = {
    groupedLo: context.slice(loAt, loAt + GROUPED_BYTES),
    groupedHi: context.slice(loAt + GROUPED_BYTES, loAt + 2 * GROUPED_BYTES),
  }
  if (
    !bytesEqual(grouped.groupedLo.slice(0, POINT_BYTES), transfer.commitmentLo) ||
    !bytesEqual(grouped.groupedHi.slice(0, POINT_BYTES), transfer.commitmentHi)
  ) {
    return refuse('ciphertext-mismatch')
  }

  const full = new Uint8Array(EQUALITY_CONTEXT_BYTES + EQUALITY_PROOF_BYTES)
  full.set(context.slice(0, POINT_BYTES), 0)
  full.set(combineCiphertext(grouped, HANDLE.source).toBytes(), POINT_BYTES)
  full.set(commitmentTo(units).toBytes(), 3 * POINT_BYTES)
  full.set(bytes.slice(PROOF_AT), EQUALITY_CONTEXT_BYTES)
  try {
    CiphertextCommitmentEqualityProofData.fromBytes(full).verify()
  } catch {
    return refuse('proof-mismatch')
  }
  return { ok: true, units, transferSignature }
}
