import {
  type AccountMeta,
  generateKeyPairSigner,
  type Instruction,
  type InstructionPlan,
  type InstructionWithAccounts,
  type InstructionWithData,
  type ReadonlyUint8Array,
} from '@solana/kit'
import {
  findAssociatedTokenPda,
  parseCreateAssociatedTokenIdempotentInstruction,
  parseMintToCheckedInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022'
import { describe, expect, it } from 'vitest'
import { mintToPlan, parseMintToArgs } from './mint-to.ts'

const WALLET = 'C252hVhqTYfNz1PcUUXTVYjaZgJ1ozW1dYp9fXPZyqVu'

type Parsable = Instruction &
  InstructionWithAccounts<readonly AccountMeta[]> &
  InstructionWithData<ReadonlyUint8Array>

function isParsable(ix: Instruction): ix is Parsable {
  return !!ix.data && !!ix.accounts
}

function flatten(plan: InstructionPlan): Parsable[] {
  if (plan.kind === 'single') return [plan.instruction].filter(isParsable)
  if (plan.kind === 'messagePacker') throw new Error('message packers are not expected here')
  return plan.plans.flatMap(flatten)
}

describe('parseMintToArgs', () => {
  it('accepts a base58 wallet and integer base units', () => {
    expect(parseMintToArgs([WALLET, '25000000'])).toEqual({ wallet: WALLET, units: 25_000_000n })
  })

  it('accepts units beyond Number.MAX_SAFE_INTEGER without losing precision', () => {
    expect(parseMintToArgs([WALLET, '18446744073709551615']).units).toBe(
      18_446_744_073_709_551_615n,
    )
  })

  it('rejects a malformed wallet', () => {
    expect(() => parseMintToArgs(['not-an-address', '1'])).toThrow(/wallet/)
  })

  it('rejects zero, fractional and missing units', () => {
    expect(() => parseMintToArgs([WALLET, '0'])).toThrow(/units/)
    expect(() => parseMintToArgs([WALLET, '1.5'])).toThrow(/units/)
    expect(() => parseMintToArgs([WALLET])).toThrow(/units/)
  })

  it('rejects units above u64', () => {
    expect(() => parseMintToArgs([WALLET, '18446744073709551616'])).toThrow(/units/)
  })
})

describe('mintToPlan', () => {
  it('creates the ATA idempotently and mints the exact units with checked decimals', async () => {
    const authority = await generateKeyPairSigner()
    const mint = await generateKeyPairSigner()
    const { wallet, units } = parseMintToArgs([WALLET, '7250000'])
    const [ata] = await findAssociatedTokenPda({
      owner: wallet,
      mint: mint.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    })

    const plan = await mintToPlan({ authority, mint: mint.address, decimals: 6, wallet, units })
    const [create, mintTo, ...rest] = flatten(plan)
    expect(rest).toHaveLength(0)
    if (!create || !mintTo) throw new Error('plan is shorter than two instructions')

    const created = parseCreateAssociatedTokenIdempotentInstruction(create)
    expect(created.accounts.ata.address).toBe(ata)
    expect(created.accounts.owner.address).toBe(wallet)
    expect(created.accounts.tokenProgram.address).toBe(TOKEN_2022_PROGRAM_ADDRESS)

    const minted = parseMintToCheckedInstruction(mintTo)
    expect(minted.accounts.token.address).toBe(ata)
    expect(minted.accounts.mintAuthority.address).toBe(authority.address)
    expect(minted.data).toMatchObject({ amount: 7_250_000n, decimals: 6 })
  })
})
