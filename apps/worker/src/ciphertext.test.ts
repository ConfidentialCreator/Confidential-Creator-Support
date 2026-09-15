import { readFileSync } from 'node:fs'
import { extractValidityContext } from '@ccsupport/chain'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { type ChainReader, fetchRecipientCiphertext, validityContextAddress } from './ciphertext.ts'

const LOGS_DIR = new URL('../../../fixtures/logs/', import.meta.url)
const TX_DIR = new URL('../../../fixtures/tx/', import.meta.url)

const pledgeFixture = z.object({
  signature: z.string(),
  wire: z.string(),
  ciphertext: z.object({
    context: z.string(),
    signatures: z.array(z.string()),
    proof: z.object({ signature: z.string(), wire: z.string() }),
  }),
})
type PledgeFixture = z.infer<typeof pledgeFixture>
const pledge = (name: string): PledgeFixture =>
  pledgeFixture.parse(JSON.parse(readFileSync(new URL(`${name}.json`, LOGS_DIR), 'utf8')))
const wireOf = (dir: URL, name: string): string =>
  z
    .object({ wire: z.string() })
    .parse(JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'))).wire

// The chain as the worker sees it: transfer, then the three transactions that touched
// the validity context-state account (newest first, as the RPC lists them).
function readerFor(
  fixture: PledgeFixture,
  wires: Record<string, string>,
): ChainReader & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    wire: (signature) => {
      calls.push(`wire:${signature}`)
      return Promise.resolve(wires[signature] ?? null)
    },
    signaturesFor: (address) => {
      calls.push(`sigs:${address}`)
      return Promise.resolve(
        address === fixture.ciphertext.context ? fixture.ciphertext.signatures : [],
      )
    },
    blockTime: () => Promise.resolve(null),
  }
}

describe('validityContextAddress', () => {
  it('is account 4 of the Transfer in a real Transfer + pledge transaction', () => {
    const first = pledge('pledge-first')
    expect(validityContextAddress(first.wire)).toBe(first.ciphertext.context)
    const renewal = pledge('pledge-renewal')
    expect(validityContextAddress(renewal.wire)).toBe(renewal.ciphertext.context)
  })

  it('matches the context-state account the proof transaction created (spike fixtures)', () => {
    expect(validityContextAddress(wireOf(TX_DIR, 'transfer'))).toBe(
      '4enAJpX5gKV2r3VnVsxy1LKy7sz1dWNcLZyHMjhPJyZM',
    )
  })

  it('is null for a transaction without a confidential Transfer', () => {
    expect(validityContextAddress(wireOf(LOGS_DIR, 'register'))).toBeNull()
  })
})

describe('fetchRecipientCiphertext', () => {
  it('walks the context account history oldest → newest and stops at the proof', async () => {
    const first = pledge('pledge-first')
    const proof = first.ciphertext.proof
    const reader = readerFor(first, {
      [first.signature]: first.wire,
      [proof.signature]: proof.wire,
      [first.ciphertext.signatures[0] ?? '']: 'ignored-close',
    })
    const result = await fetchRecipientCiphertext(reader, first.signature)
    const expected = extractValidityContext(proof.wire)
    expect(result.proofSig).toBe(proof.signature)
    expect(result.groupedLo).toEqual(expected?.groupedLo)
    expect(result.groupedHi).toEqual(expected?.groupedHi)
    expect(result.groupedLo).toHaveLength(128)
    expect(reader.calls).toEqual([
      `wire:${first.signature}`,
      `sigs:${first.ciphertext.context}`,
      `wire:${proof.signature}`,
    ])
  })

  it('fails when the transfer is not served yet', async () => {
    const first = pledge('pledge-first')
    const reader = readerFor(first, {})
    await expect(fetchRecipientCiphertext(reader, first.signature)).rejects.toThrow(first.signature)
  })

  it('fails when the transaction carries no confidential Transfer', async () => {
    const first = pledge('pledge-first')
    const reader = readerFor(first, { [first.signature]: wireOf(LOGS_DIR, 'register') })
    await expect(fetchRecipientCiphertext(reader, first.signature)).rejects.toThrow(/Transfer/)
  })

  it('fails when no transaction on the context account carries the validity proof', async () => {
    const first = pledge('pledge-first')
    const close = wireOf(TX_DIR, 'close')
    const reader = readerFor(first, {
      [first.signature]: first.wire,
      [first.ciphertext.proof.signature]: close,
      [first.ciphertext.signatures[0] ?? '']: close,
    })
    await expect(fetchRecipientCiphertext(reader, first.signature)).rejects.toThrow(
      first.ciphertext.context,
    )
  })

  it('fails when a transaction in the context history is not served yet', async () => {
    const first = pledge('pledge-first')
    const reader = readerFor(first, { [first.signature]: first.wire })
    await expect(fetchRecipientCiphertext(reader, first.signature)).rejects.toThrow(
      first.ciphertext.proof.signature,
    )
  })
})
