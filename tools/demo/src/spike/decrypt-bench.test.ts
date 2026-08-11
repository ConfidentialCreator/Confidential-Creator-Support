import { AeKey, ElGamalKeypair } from '@solana/zk-sdk'
import { describe, expect, it } from 'vitest'
import {
  decryptAvailable,
  decryptCombined,
  decryptSplit,
  encryptContribution,
  HANDLE,
  MAX_COMBINED_AMOUNT,
  MAX_SPLIT_AMOUNT,
  splitAmount,
  timed,
} from './decrypt-bench.ts'

const source = new ElGamalKeypair()
const destination = new ElGamalKeypair()
const auditor = new ElGamalKeypair()
const stranger = new ElGamalKeypair()
const pubkeys = {
  source: source.pubkey(),
  destination: destination.pubkey(),
  auditor: auditor.pubkey(),
}

describe('splitAmount', () => {
  it('splits like the transfer instruction: 16-bit lo, 32-bit hi', () => {
    expect(splitAmount(7_250_000n)).toEqual({ lo: 41_040n, hi: 110n })
    expect(splitAmount(0n)).toEqual({ lo: 0n, hi: 0n })
    expect(splitAmount(MAX_SPLIT_AMOUNT)).toEqual({ lo: 65_535n, hi: 4_294_967_295n })
  })

  it('rejects amounts outside 0..2^48-1', () => {
    expect(() => splitAmount(-1n)).toThrow(RangeError)
    expect(() => splitAmount(MAX_SPLIT_AMOUNT + 1n)).toThrow(RangeError)
  })
})

describe('decryptSplit (two discrete logs, as the SDK does)', () => {
  const ciphertext = encryptContribution(pubkeys, 7_250_000n)

  it('recovers the amount from the destination and auditor handles', () => {
    expect(decryptSplit(destination.secret(), HANDLE.destination, ciphertext)).toBe(7_250_000n)
    expect(decryptSplit(auditor.secret(), HANDLE.auditor, ciphertext)).toBe(7_250_000n)
  })

  it('handles the full 48-bit range', () => {
    const big = encryptContribution(pubkeys, MAX_SPLIT_AMOUNT)
    expect(decryptSplit(source.secret(), HANDLE.source, big)).toBe(MAX_SPLIT_AMOUNT)
  })

  it('returns undefined for a foreign key, never a number', () => {
    expect(decryptSplit(stranger.secret(), HANDLE.destination, ciphertext)).toBeUndefined()
  })
})

describe('decryptCombined (one discrete log over lo + hi·2^16)', () => {
  it('recovers amounts below 2^32', () => {
    const ciphertext = encryptContribution(pubkeys, 7_250_000n)
    expect(decryptCombined(destination.secret(), HANDLE.destination, ciphertext)).toBe(7_250_000n)
    const edge = encryptContribution(pubkeys, MAX_COMBINED_AMOUNT)
    expect(decryptCombined(auditor.secret(), HANDLE.auditor, edge)).toBe(MAX_COMBINED_AMOUNT)
  })

  it('returns undefined above 2^32 and for a foreign key', () => {
    const tooBig = encryptContribution(pubkeys, MAX_COMBINED_AMOUNT + 1n)
    expect(decryptCombined(destination.secret(), HANDLE.destination, tooBig)).toBeUndefined()
    const ciphertext = encryptContribution(pubkeys, 5n)
    expect(decryptCombined(stranger.secret(), HANDLE.destination, ciphertext)).toBeUndefined()
  })
})

describe('decryptAvailable (AES decryptable balance)', () => {
  const key = new AeKey()
  const ciphertext = key.encrypt(17_750_000n).toBytes()

  it('recovers the balance with the right key', () => {
    expect(decryptAvailable(key, ciphertext)).toBe(17_750_000n)
  })

  it('returns undefined for a foreign key or malformed bytes', () => {
    expect(decryptAvailable(new AeKey(), ciphertext)).toBeUndefined()
    expect(decryptAvailable(key, new Uint8Array(3))).toBeUndefined()
  })
})

describe('timed', () => {
  it('reports total, mean and max from the injected clock', () => {
    let tick = 0
    const now = () => {
      tick += 10
      return tick
    }
    const result = timed([1, 2, 3], (n) => n * 2, now)
    expect(result.results).toEqual([2, 4, 6])
    expect(result.totalMs).toBe(30)
    expect(result.meanMs).toBe(10)
    expect(result.maxMs).toBe(10)
  })

  it('is empty-safe', () => {
    expect(
      timed(
        [],
        () => 0,
        () => 0,
      ),
    ).toEqual({ results: [], totalMs: 0, meanMs: 0, maxMs: 0 })
  })
})
