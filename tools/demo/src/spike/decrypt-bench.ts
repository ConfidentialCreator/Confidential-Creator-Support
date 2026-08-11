import { ristretto255 } from '@noble/curves/ed25519.js'
import {
  AeCiphertext,
  type AeKey,
  ElGamalCiphertext,
  type ElGamalPubkey,
  type ElGamalSecretKey,
  GroupedElGamalCiphertext3Handles,
} from '@solana/zk-sdk'

// Сума переказу в Token-2022 їде двома шифротекстами: lo — 16 біт, hi — 32 біти.
export const LO_BITS = 16n
export const MAX_SPLIT_AMOUNT = (1n << 48n) - 1n
// Декодер дискретного логарифму в zk-sdk шукає лише в 32 бітах.
export const MAX_COMBINED_AMOUNT = (1n << 32n) - 1n

// Порядок хендлів у grouped-шифротексті контексту validity-доказу переказу.
export const HANDLE = { source: 0, destination: 1, auditor: 2 } as const
export type Handle = (typeof HANDLE)[keyof typeof HANDLE]

export type ContributionCiphertext = { lo: Uint8Array; hi: Uint8Array }

export function splitAmount(amount: bigint): { lo: bigint; hi: bigint } {
  if (amount < 0n || amount > MAX_SPLIT_AMOUNT) {
    throw new RangeError(`amount must be within 0..2^48-1, got ${amount}`)
  }
  return { lo: amount & ((1n << LO_BITS) - 1n), hi: amount >> LO_BITS }
}

export function encryptContribution(
  keys: { source: ElGamalPubkey; destination: ElGamalPubkey; auditor: ElGamalPubkey },
  amount: bigint,
): ContributionCiphertext {
  const { lo, hi } = splitAmount(amount)
  const encrypt = (part: bigint) =>
    GroupedElGamalCiphertext3Handles.encrypt(keys.source, keys.destination, keys.auditor, part)
  return { lo: encrypt(lo).toBytes(), hi: encrypt(hi).toBytes() }
}

function decryptOrUndefined(run: () => bigint): bigint | undefined {
  // wasm кидає порожню помилку, коли дискретний логарифм не знайдено (чужий ключ
  // або значення поза 32 бітами) — це штатна відмова, не збій.
  try {
    return run()
  } catch {
    return undefined
  }
}

export function decryptSplit(
  secret: ElGamalSecretKey,
  handle: Handle,
  ciphertext: ContributionCiphertext,
): bigint | undefined {
  const lo = decryptOrUndefined(() =>
    GroupedElGamalCiphertext3Handles.fromBytes(ciphertext.lo).decrypt(secret, handle),
  )
  if (lo === undefined) return undefined
  const hi = decryptOrUndefined(() =>
    GroupedElGamalCiphertext3Handles.fromBytes(ciphertext.hi).decrypt(secret, handle),
  )
  return hi === undefined ? undefined : lo + (hi << LO_BITS)
}

const { Point } = ristretto255

function groupedToPoints(grouped: Uint8Array, handle: Handle) {
  return {
    commitment: Point.fromBytes(grouped.slice(0, 32)),
    handle: Point.fromBytes(grouped.slice(32 + handle * 32, 64 + handle * 32)),
  }
}

// lo + hi·2^16 як один шифротекст: одна операція дискретного логарифму замість двох.
export function decryptCombined(
  secret: ElGamalSecretKey,
  handle: Handle,
  ciphertext: ContributionCiphertext,
): bigint | undefined {
  const lo = groupedToPoints(ciphertext.lo, handle)
  const hi = groupedToPoints(ciphertext.hi, handle)
  const scale = 1n << LO_BITS
  const bytes = new Uint8Array(64)
  bytes.set(lo.commitment.add(hi.commitment.multiply(scale)).toBytes(), 0)
  bytes.set(lo.handle.add(hi.handle.multiply(scale)).toBytes(), 32)
  const combined = ElGamalCiphertext.fromBytes(bytes)
  if (!combined) return undefined
  return decryptOrUndefined(() => secret.decrypt(combined))
}

export function decryptAvailable(key: AeKey, ciphertext: Uint8Array): bigint | undefined {
  const parsed = AeCiphertext.fromBytes(ciphertext)
  if (!parsed) return undefined
  return decryptOrUndefined(() => key.decrypt(parsed))
}

export type Timed<T> = { results: T[]; totalMs: number; meanMs: number; maxMs: number }

export function timed<TItem, TResult>(
  items: readonly TItem[],
  run: (item: TItem) => TResult,
  now: () => number,
): Timed<TResult> {
  const results: TResult[] = []
  let totalMs = 0
  let maxMs = 0
  for (const item of items) {
    const started = now()
    results.push(run(item))
    const elapsed = now() - started
    totalMs += elapsed
    if (elapsed > maxMs) maxMs = elapsed
  }
  return { results, totalMs, meanMs: items.length === 0 ? 0 : totalMs / items.length, maxMs }
}
