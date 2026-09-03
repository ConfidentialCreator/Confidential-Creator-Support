import { readFileSync } from 'node:fs'
import {
  AccountRole,
  type Address,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getU32Encoder,
  type Instruction,
  pipe,
  type SignatureBytes,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Transaction,
} from '@solana/kit'
import {
  getCloseAccountInstruction,
  getInitializeInstruction,
  getSetAuthorityInstruction,
  getWriteInstruction,
  RECORD_PROGRAM_ADDRESS,
} from '@solana-program/record'
import {
  getCreateAccountInstruction,
  SYSTEM_PROGRAM_ADDRESS,
  SystemInstruction,
} from '@solana-program/system'
import {
  getCloseContextStateInstruction,
  getVerifyProofInstruction,
  ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  ZkElGamalProofInstruction,
} from '@solana-program/zk-elgamal-proof'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  MAX_CREATE_ACCOUNT_LAMPORTS,
  MAX_CREATE_ACCOUNT_SPACE,
  RELAY_MAX_TRANSACTION_BYTES,
  validateRelayTransaction,
} from './validate.ts'

const FIXTURE_DIR = new URL('../../../../fixtures/tx/', import.meta.url)
const fixtureSchema = z.object({ wire: z.string(), sizeBytes: z.number().int() })
const fixture = (name: string) =>
  fixtureSchema.parse(JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_DIR), 'utf8')))

// Fee payer of the T006 spike transactions.
const SPIKE_PAYER = address('D4TkDq52FCqPyvwgQWBDepBumsYKB5ZjroRLfGckrYnQ')
const PAYER = address('AJ6LFWEJgLEwkfyWWipZ8Le5fV9QjCV61UCnzv9g5ZUq')
const STRANGER = address('6f1QTLNPh59wM26CQx1pnJTUcE814H64JaABjARPvtiC')
const CONTEXT = address('44s5oipjXK9rzz7Mgn5GfmFiPhdzcRA2PbTSAqCgRA1v')
const RECORD = address('FamDcm8DcmC6emWqFrNsiKxY2PQyUjPkoEzdSdnqrXA6')
const RECORD_AUTHORITY = address('Fs6wMEGuTZs4aPdRNgKgXdPEQQuWbtpJVZ1V7Z1hj1Yd')
const BLOCKHASH = blockhash('9zwFRXGrRTvgmxRvMyBYyGqYr8WLrN5rBmhdEcGB5b9A')

const signer = (a: Address) => createNoopSigner(a)
const PRESENT = new Uint8Array(64).fill(7) as SignatureBytes

// Every signer slot but the payer's is filled: the relay checks presence, the
// network checks validity.
function wireOf(
  instructions: Instruction[],
  payer: Address = PAYER,
  missing: Address[] = [],
  lookupTable: Address[] = [],
) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(payer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: BLOCKHASH, lastValidBlockHeight: 1n },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) =>
      lookupTable.length === 0
        ? m
        : compressTransactionMessageUsingAddressLookupTables(m, { [STRANGER]: lookupTable }),
  )
  const compiled = compileTransaction(message)
  const signatures = Object.fromEntries(
    Object.keys(compiled.signatures).map((a) => [
      a,
      a === payer || missing.includes(address(a)) ? null : PRESENT,
    ]),
  )
  const transaction: Transaction = { ...compiled, signatures }
  return getBase64EncodedWireTransaction(transaction)
}

const createContext = (
  overrides: Partial<{ lamports: bigint; space: bigint; owner: Address }> = {},
) =>
  getCreateAccountInstruction({
    payer: signer(PAYER),
    newAccount: signer(CONTEXT),
    lamports: overrides.lamports ?? 2_000_000n,
    space: overrides.space ?? 161n,
    programAddress: overrides.owner ?? ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  })

const verifyInline = (authority: Address = PAYER) =>
  getVerifyProofInstruction({
    discriminator: ZkElGamalProofInstruction.VerifyCiphertextCommitmentEquality,
    contextState: CONTEXT,
    contextStateAuthority: authority,
    proofData: new Uint8Array(320),
  })

const reason = (wire: string, mode: 'proofs' | 'close', payer: Address = PAYER) => {
  const result = validateRelayTransaction(wire, payer, mode)
  return result.ok ? 'ok' : result.reason
}

describe('validateRelayTransaction on the T006 fixtures', () => {
  it('accepts the four proof transactions of a transfer', () => {
    for (const name of ['proof-1', 'proof-2', 'proof-3', 'proof-4']) {
      const { wire, sizeBytes } = fixture(name)
      const result = validateRelayTransaction(wire, SPIKE_PAYER, 'proofs')
      expect(result.ok, name).toBe(true)
      if (result.ok) expect(Object.keys(result.transaction.signatures)[0]).toBe(SPIKE_PAYER)
      expect(sizeBytes).toBeLessThanOrEqual(RELAY_MAX_TRANSACTION_BYTES)
    }
  })

  it('accepts the close transaction in close mode', () => {
    expect(reason(fixture('close').wire, 'close', SPIKE_PAYER)).toBe('ok')
  })

  it('rejects a Token-2022 transfer, a foreign fee payer and the wrong mode', () => {
    expect(reason(fixture('transfer').wire, 'proofs', SPIKE_PAYER)).toMatch(/fee payer/)
    expect(reason(fixture('configure').wire, 'proofs', SPIKE_PAYER)).toMatch(
      /instruction 0: program ATokenGP/,
    )
    expect(reason(fixture('proof-1').wire, 'proofs', PAYER)).toMatch(/fee payer/)
    expect(reason(fixture('proof-1').wire, 'close', SPIKE_PAYER)).toMatch(
      /instruction 0: .*not allowed when closing/,
    )
    expect(reason(fixture('close').wire, 'proofs', SPIKE_PAYER)).toMatch(
      /instruction 0: .*CloseContextState/,
    )
  })

  it('rejects anything over the wire limit before decoding it', () => {
    const { wire, sizeBytes } = fixture('proof-3')
    expect(sizeBytes).toBe(RELAY_MAX_TRANSACTION_BYTES)
    const oversized = Buffer.concat([Buffer.from(wire, 'base64'), Buffer.from([0])]).toString(
      'base64',
    )
    expect(reason(oversized, 'proofs', SPIKE_PAYER)).toMatch(/1233 bytes/)
  })

  it('rejects input that is not a transaction', () => {
    expect(reason('not base64!', 'proofs')).toMatch(/base64/)
    expect(reason(Buffer.from([1, 2, 3]).toString('base64'), 'proofs')).toMatch(/decode/)
  })
})

describe('validateRelayTransaction, proofs mode', () => {
  it('accepts create + inline verify and create + record write', () => {
    expect(reason(wireOf([createContext(), verifyInline()]), 'proofs')).toBe('ok')
    const record = [
      createContext({ owner: RECORD_PROGRAM_ADDRESS, space: BigInt(MAX_CREATE_ACCOUNT_SPACE) }),
      getInitializeInstruction({ recordAccount: CONTEXT, authority: RECORD_AUTHORITY }),
      getWriteInstruction({
        recordAccount: CONTEXT,
        authority: signer(RECORD_AUTHORITY),
        offset: 0n,
        data: new Uint8Array(100),
      }),
    ]
    expect(reason(wireOf(record), 'proofs')).toBe('ok')
  })

  it('rejects a missing signature from any account but the payer', () => {
    expect(reason(wireOf([createContext(), verifyInline()], PAYER, [CONTEXT]), 'proofs')).toMatch(
      /signature.*44s5oipj/,
    )
  })

  it('rejects an empty transaction and address lookup tables', () => {
    expect(reason(wireOf([]), 'proofs')).toMatch(/no instructions/)
    // Addresses behind a lookup table cannot be checked without the chain.
    expect(reason(wireOf([verifyInline(RECORD)], PAYER, [], [RECORD]), 'proofs')).toMatch(
      /lookup table/,
    )
  })

  it('rejects CreateAccount that funds anything but a proof context or a record', () => {
    expect(reason(wireOf([createContext({ owner: STRANGER })]), 'proofs')).toMatch(/owner/)
    expect(reason(wireOf([createContext({ owner: PAYER })]), 'proofs')).toMatch(/owner/)
  })

  it('rejects CreateAccount above the rent and size caps', () => {
    expect(
      reason(wireOf([createContext({ lamports: MAX_CREATE_ACCOUNT_LAMPORTS + 1n })]), 'proofs'),
    ).toMatch(/lamports/)
    expect(
      reason(wireOf([createContext({ space: BigInt(MAX_CREATE_ACCOUNT_SPACE) + 1n })]), 'proofs'),
    ).toMatch(/space/)
    expect(
      reason(
        wireOf([
          createContext({
            lamports: MAX_CREATE_ACCOUNT_LAMPORTS,
            space: BigInt(MAX_CREATE_ACCOUNT_SPACE),
          }),
        ]),
        'proofs',
      ),
    ).toBe('ok')
  })

  it('rejects other System instructions', () => {
    // Assembled by hand: the SDK builder's input names the lamport field in a way
    // the guard in scripts/ rejects.
    const transfer: Instruction = {
      programAddress: SYSTEM_PROGRAM_ADDRESS,
      accounts: [
        { address: PAYER, role: AccountRole.WRITABLE_SIGNER },
        { address: STRANGER, role: AccountRole.WRITABLE },
      ],
      data: new Uint8Array([
        ...getU32Encoder().encode(SystemInstruction.TransferSol),
        ...new Uint8Array(8),
      ]),
    }
    expect(reason(wireOf([transfer]), 'proofs')).toMatch(/instruction 0: .*TransferSol/)
  })

  it('rejects a proof context whose authority is not the payer', () => {
    expect(reason(wireOf([createContext(), verifyInline(STRANGER)]), 'proofs')).toMatch(
      /instruction 1: .*authority/,
    )
    const noContext = getVerifyProofInstruction({
      discriminator: ZkElGamalProofInstruction.VerifyPubkeyValidity,
      proofData: new Uint8Array(96),
    })
    expect(reason(wireOf([noContext]), 'proofs')).toMatch(/instruction 0: .*authority/)
  })

  it('rejects CloseContextState and record SetAuthority / CloseAccount', () => {
    const close = getCloseContextStateInstruction({
      contextState: CONTEXT,
      destination: PAYER,
      authority: signer(PAYER),
    })
    expect(reason(wireOf([close]), 'proofs')).toMatch(/CloseContextState/)
    const setAuthority = getSetAuthorityInstruction({
      recordAccount: RECORD,
      authority: signer(RECORD_AUTHORITY),
      newAuthority: STRANGER,
    })
    expect(reason(wireOf([setAuthority]), 'proofs')).toMatch(/SetAuthority/)
    const closeRecord = getCloseAccountInstruction({
      recordAccount: RECORD,
      authority: signer(RECORD_AUTHORITY),
      receiver: PAYER,
    })
    expect(reason(wireOf([closeRecord]), 'proofs')).toMatch(/CloseAccount/)
  })

  it('rejects programs outside the allow-list', () => {
    const foreign: Instruction = { programAddress: STRANGER, accounts: [], data: new Uint8Array(1) }
    expect(reason(wireOf([foreign]), 'proofs')).toMatch(/instruction 0: program 6f1QTLNP/)
  })
})

describe('validateRelayTransaction, close mode', () => {
  const closeContext = (destination: Address = PAYER) =>
    getCloseContextStateInstruction({
      contextState: CONTEXT,
      destination,
      authority: signer(PAYER),
    })
  const closeRecord = (receiver: Address = PAYER) =>
    getCloseAccountInstruction({
      recordAccount: RECORD,
      authority: signer(RECORD_AUTHORITY),
      receiver,
    })

  it('accepts context and record closes that return rent to the payer', () => {
    expect(reason(wireOf([closeContext(), closeContext(), closeRecord()]), 'close')).toBe('ok')
  })

  it('rejects rent sent anywhere but the payer', () => {
    expect(reason(wireOf([closeContext(STRANGER)]), 'close')).toMatch(
      /instruction 0: .*destination/,
    )
    expect(reason(wireOf([closeRecord(STRANGER)]), 'close')).toMatch(/instruction 0: .*receiver/)
  })

  it('rejects creating or verifying while closing', () => {
    expect(reason(wireOf([closeContext(), createContext()]), 'close')).toMatch(/instruction 1/)
    expect(reason(wireOf([verifyInline()]), 'close')).toMatch(/instruction 0/)
  })
})
