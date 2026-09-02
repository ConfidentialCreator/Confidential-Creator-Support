import { ristretto255 } from '@noble/curves/ed25519.js'
import {
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  isSome,
} from '@solana/kit'
import {
  AeCiphertext,
  type AeKey,
  BatchedGroupedCiphertext3HandlesValidityProofData,
  ElGamalCiphertext,
  type ElGamalKeypair,
  type ElGamalSecretKey,
  GroupedElGamalCiphertext3Handles,
} from '@solana/zk-sdk'
import type { Token } from '@solana-program/token-2022'
import {
  ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  ZkElGamalProofInstruction,
} from '@solana-program/zk-elgamal-proof'

// Порядок хендлів у grouped-шифротексті переказу Token-2022.
export const HANDLE = { source: 0, destination: 1, auditor: 2 } as const
export type CiphertextHandle = (typeof HANDLE)[keyof typeof HANDLE]

export type ValidityContext = { groupedLo: Uint8Array; groupedHi: Uint8Array }

export type DecryptFailure = 'wrong-key' | 'malformed' | 'unconfigured'
export type DecryptResult = { ok: true; units: bigint } | { ok: false; reason: DecryptFailure }

const ELGAMAL_PUBKEY_BYTES = 32
const GROUPED_BYTES = 128
const PROOF_CONTEXT_BYTES = 3 * ELGAMAL_PUBKEY_BYTES + 2 * GROUPED_BYTES
const LO_BITS = 16n

const fail = (reason: DecryptFailure): DecryptResult => ({ ok: false, reason })

export function extractValidityContext(wire: string): ValidityContext | null {
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
  if (!('instructions' in message)) return null
  const verify = message.instructions.find(
    (ix) =>
      message.staticAccounts[ix.programAddressIndex] === ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS &&
      ix.data?.[0] === ZkElGamalProofInstruction.VerifyBatchedGroupedCiphertext3HandlesValidity,
  )
  if (!verify?.data) return null
  let context: Uint8Array
  try {
    context = BatchedGroupedCiphertext3HandlesValidityProofData.fromBytes(verify.data.slice(1))
      .context()
      .toBytes()
  } catch {
    throw new Error('validity instruction carries no inline proof data')
  }
  if (context.length !== PROOF_CONTEXT_BYTES) {
    throw new Error(
      `validity proof context is ${context.length} bytes, expected ${PROOF_CONTEXT_BYTES}`,
    )
  }
  const lo = 3 * ELGAMAL_PUBKEY_BYTES
  return {
    groupedLo: context.slice(lo, lo + GROUPED_BYTES),
    groupedHi: context.slice(lo + GROUPED_BYTES, lo + 2 * GROUPED_BYTES),
  }
}

const { Point } = ristretto255

function groupedPoints(grouped: Uint8Array, handle: CiphertextHandle) {
  if (grouped.length !== GROUPED_BYTES) throw new RangeError('grouped ciphertext size')
  const at = ELGAMAL_PUBKEY_BYTES * (1 + handle)
  return {
    commitment: Point.fromBytes(grouped.slice(0, ELGAMAL_PUBKEY_BYTES)),
    handle: Point.fromBytes(grouped.slice(at, at + ELGAMAL_PUBKEY_BYTES)),
  }
}

// lo + hi·2¹⁶ як один шифротекст — один дискретний логарифм замість двох.
function combine(ciphertext: ValidityContext, handle: CiphertextHandle): ElGamalCiphertext {
  const lo = groupedPoints(ciphertext.groupedLo, handle)
  const hi = groupedPoints(ciphertext.groupedHi, handle)
  const scale = 1n << LO_BITS
  const bytes = new Uint8Array(2 * ELGAMAL_PUBKEY_BYTES)
  bytes.set(lo.commitment.add(hi.commitment.multiply(scale)).toBytes(), 0)
  bytes.set(lo.handle.add(hi.handle.multiply(scale)).toBytes(), ELGAMAL_PUBKEY_BYTES)
  const combined = ElGamalCiphertext.fromBytes(bytes)
  if (!combined) throw new RangeError('combined ciphertext does not parse')
  return combined
}

// wasm кидає рядок, не Error, коли логарифм не знайдено (чужий ключ або значення
// поза 32 бітами) — це штатна відмова.
function tryDecrypt(run: () => bigint): bigint | undefined {
  try {
    return run()
  } catch {
    return undefined
  }
}

export function decryptContribution(
  elgamal: ElGamalKeypair,
  ciphertext: ValidityContext,
  handle: CiphertextHandle = HANDLE.destination,
): DecryptResult {
  let combined: ElGamalCiphertext
  let lo: GroupedElGamalCiphertext3Handles
  let hi: GroupedElGamalCiphertext3Handles
  try {
    combined = combine(ciphertext, handle)
    lo = GroupedElGamalCiphertext3Handles.fromBytes(ciphertext.groupedLo)
    hi = GroupedElGamalCiphertext3Handles.fromBytes(ciphertext.groupedHi)
  } catch {
    return fail('malformed')
  }
  const secret: ElGamalSecretKey = elgamal.secret()
  const units = tryDecrypt(() => secret.decrypt(combined))
  if (units !== undefined) return { ok: true, units }
  // Понад 2³² одиниць склеєне значення поза межами пошуку — частини окремо.
  const partLo = tryDecrypt(() => lo.decrypt(secret, handle))
  const partHi = tryDecrypt(() => hi.decrypt(secret, handle))
  if (partLo === undefined || partHi === undefined) return fail('wrong-key')
  return { ok: true, units: partLo + (partHi << LO_BITS) }
}

export function decryptAvailable(ae: AeKey, account: Token): DecryptResult {
  const extension = isSome(account.extensions)
    ? account.extensions.value.find((e) => e.__kind === 'ConfidentialTransferAccount')
    : undefined
  if (!extension) return fail('unconfigured')
  const decryptable = AeCiphertext.fromBytes(new Uint8Array(extension.decryptableAvailableBalance))
  if (!decryptable) return fail('malformed')
  const units = tryDecrypt(() => ae.decrypt(decryptable))
  return units === undefined ? fail('wrong-key') : { ok: true, units }
}
