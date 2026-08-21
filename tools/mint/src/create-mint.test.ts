import {
  type AccountMeta,
  generateKeyPairSigner,
  type Instruction,
  type InstructionPlan,
  type InstructionWithAccounts,
  type InstructionWithData,
  lamports,
  type ReadonlyUint8Array,
} from '@solana/kit'
import { ElGamalKeypair } from '@solana/zk-sdk'
import {
  identifyToken2022Instruction,
  parseInitializeConfidentialTransferMintInstruction,
  parseInitializeMetadataPointerInstruction,
  parseInitializeMintInstruction,
  parseInitializeTokenMetadataInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
  Token2022Instruction,
} from '@solana-program/token-2022'
import { describe, expect, it } from 'vitest'
import {
  createMintPlan,
  DECIMALS,
  elgamalAddress,
  TOKEN_NAME,
  TOKEN_SYMBOL,
} from './create-mint.ts'

const rent = { getMinimumBalance: async (space: number) => lamports(BigInt(space) * 10n) }

type Typed = Instruction<typeof TOKEN_2022_PROGRAM_ADDRESS> &
  InstructionWithAccounts<readonly AccountMeta[]> &
  InstructionWithData<ReadonlyUint8Array>

function isToken2022(ix: Instruction): ix is Typed {
  return ix.programAddress === TOKEN_2022_PROGRAM_ADDRESS && !!ix.data && !!ix.accounts
}

function flatten(plan: InstructionPlan): Instruction[] {
  if (plan.kind === 'single') return [plan.instruction]
  if (plan.kind === 'messagePacker') throw new Error('message packers are not expected here')
  return plan.plans.flatMap(flatten)
}

function token2022Kinds(plan: InstructionPlan): Token2022Instruction[] {
  return flatten(plan)
    .filter(isToken2022)
    .map((ix) => identifyToken2022Instruction(ix.data))
}

function byKind(instructions: Instruction[], kind: Token2022Instruction): Typed {
  const found = instructions
    .filter(isToken2022)
    .find((ix) => identifyToken2022Instruction(ix.data) === kind)
  if (!found) throw new Error(`no ${Token2022Instruction[kind]} instruction in plan`)
  return found
}

describe('elgamalAddress', () => {
  it('encodes the 32-byte ElGamal pubkey as a base58 address', () => {
    const keypair = new ElGamalKeypair()
    const address = elgamalAddress(keypair.pubkey())
    expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
  })
})

describe('createMintPlan', () => {
  it('round-trips confidential-transfer, metadata and mint init through the kit decoders', async () => {
    const authority = await generateKeyPairSigner()
    const mint = await generateKeyPairSigner()
    const auditor = new ElGamalKeypair()

    const plan = await createMintPlan(rent, { authority, mint, auditor: auditor.pubkey() })
    const instructions = flatten(plan)

    const ct = parseInitializeConfidentialTransferMintInstruction(
      byKind(instructions, Token2022Instruction.InitializeConfidentialTransferMint),
    )
    expect(ct.data.autoApproveNewAccounts).toBe(true)
    expect(ct.data.authority).toEqual({ __option: 'Some', value: authority.address })
    expect(ct.data.auditorElgamalPubkey).toEqual({
      __option: 'Some',
      value: elgamalAddress(auditor.pubkey()),
    })

    const pointer = parseInitializeMetadataPointerInstruction(
      byKind(instructions, Token2022Instruction.InitializeMetadataPointer),
    )
    expect(pointer.data.metadataAddress).toEqual({ __option: 'Some', value: mint.address })

    const init = parseInitializeMintInstruction(
      byKind(instructions, Token2022Instruction.InitializeMint),
    )
    expect(init.data.decimals).toBe(DECIMALS)
    expect(init.data.mintAuthority).toBe(authority.address)
    expect(init.data.freezeAuthority).toEqual({ __option: 'None' })

    const metadata = parseInitializeTokenMetadataInstruction(
      byKind(instructions, Token2022Instruction.InitializeTokenMetadata),
    )
    expect(metadata.data).toMatchObject({ name: TOKEN_NAME, symbol: TOKEN_SYMBOL, uri: '' })
    expect(metadata.accounts.mintAuthority.address).toBe(authority.address)
  })

  it('initializes extensions before the mint and metadata after it', async () => {
    const authority = await generateKeyPairSigner()
    const mint = await generateKeyPairSigner()
    const auditor = new ElGamalKeypair()

    const kinds = token2022Kinds(
      await createMintPlan(rent, { authority, mint, auditor: auditor.pubkey() }),
    )
    const at = (kind: Token2022Instruction) => kinds.indexOf(kind)

    expect(at(Token2022Instruction.InitializeConfidentialTransferMint)).toBeLessThan(
      at(Token2022Instruction.InitializeMint),
    )
    expect(at(Token2022Instruction.InitializeMetadataPointer)).toBeLessThan(
      at(Token2022Instruction.InitializeMint),
    )
    expect(at(Token2022Instruction.InitializeTokenMetadata)).toBeGreaterThan(
      at(Token2022Instruction.InitializeMint),
    )
  })
})
