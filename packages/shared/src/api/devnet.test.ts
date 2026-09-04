import { describe, expect, it } from 'vitest'
import { faucetRequestSchema, faucetResponseSchema } from './devnet.ts'

const WALLET = 'D4TkDq52FCqPyvwgQWBDepBumsYKB5ZjroRLfGckrYnQ'

describe('faucetRequestSchema', () => {
  it('accepts a base58 wallet address', () => {
    expect(faucetRequestSchema.parse({ wallet: WALLET }).wallet).toBe(WALLET)
  })

  it('rejects a malformed address and a missing field', () => {
    expect(faucetRequestSchema.safeParse({ wallet: 'nope' }).success).toBe(false)
    expect(faucetRequestSchema.safeParse({}).success).toBe(false)
  })
})

describe('faucetResponseSchema', () => {
  it('requires a signature and positive integer portions', () => {
    expect(
      faucetResponseSchema.safeParse({ signature: '5x', lamports: 20_000_000, units: 100_000_000 })
        .success,
    ).toBe(true)
    expect(faucetResponseSchema.safeParse({ signature: '', lamports: 1, units: 1 }).success).toBe(
      false,
    )
    expect(faucetResponseSchema.safeParse({ signature: '5x', lamports: 0, units: 1 }).success).toBe(
      false,
    )
  })
})
