import { AccountRole, type Address, address, createNoopSigner } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import {
  CCSUPPORT_PROGRAM_ADDRESS,
  parseInitConfigInstruction,
  parseMakePledgeInstruction,
  parseRegisterCreatorInstruction,
  parseSetVisibilityInstruction,
  parseUpdateCreatorInstruction,
} from './generated/index.ts'
import { configPda, creatorPda, handlePda, pledgePda } from './pda.ts'
import {
  initConfigInstruction,
  type PledgeParams,
  pledgeInstruction,
  registerCreatorInstruction,
  setVisibilityInstruction,
  updateCreatorInstruction,
} from './program.ts'

const CREATOR_WALLET = address('AJ6LFWEJgLEwkfyWWipZ8Le5fV9QjCV61UCnzv9g5ZUq')
const SUPPORTER = address('6BUPsnbo6yqeUE5UHHz6WDp6b4saTf3PPEn5B2Mp7JGZ')
const MINT = address('6f1QTLNPh59wM26CQx1pnJTUcE814H64JaABjARPvtiC')
const SYSTEM_PROGRAM = address('11111111111111111111111111111111')
const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111')

const first = async (pda: Promise<readonly [Address, number]>): Promise<Address> => (await pda)[0]

// kit encoders write `undefined` as 0 and `false`, so every builder is checked with
// a full encode → decode round trip, not just "bytes exist".
describe('initConfigInstruction', () => {
  it('resolves the Config PDA and the system program', async () => {
    const authority = createNoopSigner(SUPPORTER)
    const ix = await initConfigInstruction({ authority, mint: MINT })
    const parsed = parseInitConfigInstruction(ix)

    expect(ix.programAddress).toBe(CCSUPPORT_PROGRAM_ADDRESS)
    expect(parsed.accounts.config.address).toBe(await first(configPda()))
    expect(parsed.accounts.authority.address).toBe(SUPPORTER)
    expect(parsed.accounts.mint.address).toBe(MINT)
    expect(parsed.accounts.systemProgram.address).toBe(SYSTEM_PROGRAM)
  })
})

describe('registerCreatorInstruction', () => {
  it('round-trips the profile and resolves Creator + Handle PDAs', async () => {
    const wallet = createNoopSigner(CREATOR_WALLET)
    const args = {
      handle: 'marrow-dispatch',
      name: 'Ilse Marrow',
      description: 'The Marrow Dispatch',
    }
    const ix = await registerCreatorInstruction({ wallet, ...args })
    const parsed = parseRegisterCreatorInstruction(ix)

    expect(parsed.data).toMatchObject(args)
    expect(parsed.accounts.wallet.address).toBe(CREATOR_WALLET)
    expect(parsed.accounts.creator.address).toBe(await first(creatorPda(CREATOR_WALLET)))
    expect(parsed.accounts.handleAccount.address).toBe(await first(handlePda(args.handle)))
    expect(parsed.accounts.systemProgram.address).toBe(SYSTEM_PROGRAM)
  })

  it('keeps multibyte text intact', async () => {
    const wallet = createNoopSigner(CREATOR_WALLET)
    const args = {
      handle: 'marrow-dispatch',
      name: 'Ільзе Марроу',
      description: 'Депеша — щотижня',
    }
    const parsed = parseRegisterCreatorInstruction(
      await registerCreatorInstruction({ wallet, ...args }),
    )
    expect(parsed.data).toMatchObject(args)
  })

  it('refuses a handle the program would reject', async () => {
    const wallet = createNoopSigner(CREATOR_WALLET)
    await expect(
      registerCreatorInstruction({ wallet, handle: 'Marrow', name: 'x', description: 'y' }),
    ).rejects.toThrow()
  })
})

describe('updateCreatorInstruction', () => {
  it('round-trips the profile including a u64 suggested amount', async () => {
    const wallet = createNoopSigner(CREATOR_WALLET)
    const args = { name: 'Ilse Marrow', description: 'Weekly', suggestedAmount: 2n ** 63n + 7n }
    const ix = await updateCreatorInstruction({ wallet, ...args })
    const parsed = parseUpdateCreatorInstruction(ix)

    expect(parsed.data).toMatchObject(args)
    expect(parsed.accounts.wallet.address).toBe(CREATOR_WALLET)
    expect(parsed.accounts.creator.address).toBe(await first(creatorPda(CREATOR_WALLET)))
  })
})

describe('pledgeInstruction', () => {
  it('round-trips periods and the flag and resolves all three PDAs', async () => {
    const supporter = createNoopSigner(SUPPORTER)
    const ix = await pledgeInstruction({
      supporter,
      creatorWallet: CREATOR_WALLET,
      periods: 12,
      showPublicly: true,
    })
    const parsed = parseMakePledgeInstruction(ix)

    expect(parsed.data).toMatchObject({ periods: 12, showPublicly: true })
    expect(parsed.accounts.supporter.address).toBe(SUPPORTER)
    expect(parsed.accounts.config.address).toBe(await first(configPda()))
    expect(parsed.accounts.creator.address).toBe(await first(creatorPda(CREATOR_WALLET)))
    expect(parsed.accounts.pledge.address).toBe(await first(pledgePda(CREATOR_WALLET, SUPPORTER)))
    expect(parsed.accounts.instructions.address).toBe(INSTRUCTIONS_SYSVAR)
    expect(parsed.accounts.systemProgram.address).toBe(SYSTEM_PROGRAM)
  })

  it('does not let an absent argument silently become 0', async () => {
    const supporter = createNoopSigner(SUPPORTER)
    const missing = {
      supporter,
      creatorWallet: CREATOR_WALLET,
      showPublicly: false,
    } as unknown as PledgeParams
    await expect(pledgeInstruction(missing)).rejects.toThrow()
  })

  it.each([0, 13, 1.5])('rejects periods=%s before encoding', async (periods) => {
    const supporter = createNoopSigner(SUPPORTER)
    await expect(
      pledgeInstruction({ supporter, creatorWallet: CREATOR_WALLET, periods, showPublicly: false }),
    ).rejects.toThrow()
  })
})

describe('setVisibilityInstruction', () => {
  it.each([true, false])(
    'round-trips showPublicly=%s and resolves the Pledge PDA',
    async (showPublicly) => {
      const supporter = createNoopSigner(SUPPORTER)
      const ix = await setVisibilityInstruction({
        supporter,
        creatorWallet: CREATOR_WALLET,
        showPublicly,
      })
      const parsed = parseSetVisibilityInstruction(ix)

      expect(ix.programAddress).toBe(CCSUPPORT_PROGRAM_ADDRESS)
      expect(parsed.data).toEqual(expect.objectContaining({ showPublicly }))
      expect(parsed.accounts.supporter.address).toBe(SUPPORTER)
      expect(parsed.accounts.supporter.role).toBe(AccountRole.READONLY_SIGNER)
      expect(parsed.accounts.pledge.address).toBe(await first(pledgePda(CREATOR_WALLET, SUPPORTER)))
      expect(parsed.accounts.pledge.role).toBe(AccountRole.WRITABLE)
      expect(Object.keys(parsed.accounts)).toEqual(['supporter', 'pledge'])
    },
  )
})
