import { readFileSync } from 'node:fs'
import { CCSUPPORT_PROGRAM_ADDRESS } from '@ccsupport/chain'
import {
  AccountRole,
  address,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionSize,
} from '@solana/kit'
import {
  getConfidentialDepositInstruction,
  getConfidentialTransferInstruction,
  parseConfidentialTransferInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022'
import { describe, expect, it } from 'vitest'
import { FIXTURE_DIR, txFixtureSchema } from './fixture.ts'
import {
  findConfidentialTransfer,
  isConfidentialTransfer,
  syntheticPledge,
} from './instructions.ts'

const SUPPORTER = address('D4TkDq52FCqPyvwgQWBDepBumsYKB5ZjroRLfGckrYnQ')
const SOME = address('8tX3MJt6vzw9fw7gAeBdEtom5cfXR8BMZn9UCPQJrj6z')
const ZERO_BALANCE = new Uint8Array(36)
const ZERO_CIPHERTEXT = new Uint8Array(64)

function transferIx() {
  return getConfidentialTransferInstruction({
    sourceToken: SOME,
    mint: SOME,
    destinationToken: SOME,
    equalityRecord: SOME,
    ciphertextValidityRecord: SOME,
    rangeRecord: SOME,
    authority: SUPPORTER,
    newSourceDecryptableAvailableBalance: ZERO_BALANCE,
    transferAmountAuditorCiphertextLo: ZERO_CIPHERTEXT,
    transferAmountAuditorCiphertextHi: ZERO_CIPHERTEXT,
    equalityProofInstructionOffset: 0,
    ciphertextValidityProofInstructionOffset: 0,
    rangeProofInstructionOffset: 0,
  })
}

describe('isConfidentialTransfer', () => {
  it('recognises Token-2022 ConfidentialTransferExtension::Transfer (27/7)', () => {
    const ix = transferIx()
    expect(ix.data?.[0]).toBe(27)
    expect(ix.data?.[1]).toBe(7)
    expect(isConfidentialTransfer(ix)).toBe(true)
  })

  it('rejects another confidential instruction of the same extension', () => {
    const deposit = getConfidentialDepositInstruction({
      token: SOME,
      mint: SOME,
      authority: SUPPORTER,
      amount: 1n,
      decimals: 0,
    })
    expect(deposit.data?.[0]).toBe(27)
    expect(isConfidentialTransfer(deposit)).toBe(false)
  })

  it('rejects the same bytes under a foreign program and empty data', () => {
    const ix = transferIx()
    expect(isConfidentialTransfer({ ...ix, programAddress: CCSUPPORT_PROGRAM_ADDRESS })).toBe(false)
    expect(isConfidentialTransfer({ programAddress: TOKEN_2022_PROGRAM_ADDRESS })).toBe(false)
    expect(
      isConfidentialTransfer({
        programAddress: TOKEN_2022_PROGRAM_ADDRESS,
        data: new Uint8Array(1),
      }),
    ).toBe(false)
  })
})

describe('findConfidentialTransfer', () => {
  it('returns the index of the single transfer among neighbours', () => {
    const pledge = syntheticPledge(SUPPORTER, 4)
    expect(findConfidentialTransfer([pledge, transferIx()])).toBe(1)
  })

  it('returns -1 when there is none', () => {
    expect(findConfidentialTransfer([syntheticPledge(SUPPORTER, 4)])).toBe(-1)
  })
})

describe('syntheticPledge', () => {
  it('costs exactly what the plan budgets: program + N accounts + 13 bytes', () => {
    const ix = syntheticPledge(SUPPORTER, 4)
    expect(ix.programAddress).toBe(CCSUPPORT_PROGRAM_ADDRESS)
    expect(ix.data).toHaveLength(13)
    expect(ix.accounts).toHaveLength(5)
    expect(ix.accounts?.[0]).toEqual({ address: SUPPORTER, role: AccountRole.READONLY_SIGNER })
  })

  it('makes the extra accounts distinct and writable', () => {
    const ix = syntheticPledge(SUPPORTER, 3)
    const extras = ix.accounts?.slice(1) ?? []
    expect(new Set(extras.map((a) => a.address)).size).toBe(3)
    expect(extras.every((a) => a.role === AccountRole.WRITABLE)).toBe(true)
  })
})

describe('fixtures/tx/transfer.json (devnet, snapshot of the spike)', () => {
  const fixture = txFixtureSchema.parse(
    JSON.parse(readFileSync(new URL('transfer.json', FIXTURE_DIR), 'utf8')),
  )
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(fixture.wire))
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
  if (!('instructions' in message)) throw new Error('fixture is not a v0 transaction')
  const keys = message.staticAccounts

  it('is a single Transfer with context-state accounts and the supporter as the last account', () => {
    const transfers = message.instructions.filter(
      (ix) =>
        keys[ix.programAddressIndex] === TOKEN_2022_PROGRAM_ADDRESS &&
        ix.data?.[0] === 27 &&
        ix.data?.[1] === 7,
    )
    expect(transfers).toHaveLength(1)
    const [ix] = transfers
    const accounts = (ix?.accountIndices ?? []).map((i) => ({
      address: keys[i] ?? SOME,
      role: AccountRole.READONLY,
    }))
    const parsed = parseConfidentialTransferInstruction({
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
      accounts,
      data: ix?.data ?? new Uint8Array(),
    })
    expect(accounts).toHaveLength(7)
    expect(parsed.accounts.sourceToken.address).toBe(fixture.context.supporterToken)
    expect(parsed.accounts.mint.address).toBe(fixture.context.mint)
    expect(parsed.accounts.destinationToken.address).toBe(fixture.context.creatorToken)
    expect(parsed.accounts.authority.address).toBe(fixture.context.supporter)
    expect(parsed.data.equalityProofInstructionOffset).toBe(0)
    expect(parsed.data.rangeProofInstructionOffset).toBe(0)
  })

  it('records the wire size it was measured with, under the 1232-byte limit', () => {
    expect(getTransactionSize(transaction)).toBe(fixture.sizeBytes)
    expect(fixture.sizeBytes).toBeLessThanOrEqual(1232)
  })
})
