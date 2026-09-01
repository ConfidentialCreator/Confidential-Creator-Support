import {
  type Address,
  address,
  blockhash,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpcFromTransport,
  getAddressDecoder,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  getTransactionSize,
  type Instruction,
  type KeyPairSigner,
  none,
  type ReadonlyUint8Array,
  type RpcTransport,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  some,
} from '@solana/kit'
import { type ConfidentialKeys, ElGamalKeypair } from '@solana/zk-sdk'
import {
  identifyRecordInstruction,
  RECORD_PROGRAM_ADDRESS,
  RecordInstruction,
} from '@solana-program/record'
import {
  identifySystemInstruction,
  SYSTEM_PROGRAM_ADDRESS,
  SystemInstruction,
} from '@solana-program/system'
import {
  AccountState,
  type Extension,
  extension,
  findAssociatedTokenPda,
  getMintEncoder,
  getTokenEncoder,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Token,
} from '@solana-program/token-2022'
import {
  ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  ZkElGamalProofInstruction,
} from '@solana-program/zk-elgamal-proof'
import { beforeAll, describe, expect, it } from 'vitest'
import { CCSUPPORT_PROGRAM_ADDRESS, parseMakePledgeInstruction } from '../generated/index.ts'
import { creatorPda, pledgePda } from '../pda.ts'
import { buildContribution, type Contribution, signForRelay } from './contribute.ts'
import { deriveConfidentialKeys } from './keys.ts'

const MINT = address('6f1QTLNPh59wM26CQx1pnJTUcE814H64JaABjARPvtiC')
const PAYER = address('AJ6LFWEJgLEwkfyWWipZ8Le5fV9QjCV61UCnzv9g5ZUq')
const DECIMALS = 6
const AVAILABLE = 25_000_000n
const UNITS = 7_250_000n
const BLOCKHASH = blockhash('9zwFRXGrRTvgmxRvMyBYyGqYr8WLrN5rBmhdEcGB5b9A')
const TX_SIZE_LIMIT = 1232
// Виміряно у T006 на devnet: переказ 540 B + 4 нові акаунти `pledge` = 721 B.
const TRANSFER_WITH_PLEDGE_BYTES_T006 = 721

let supporter: KeyPairSigner
let creator: KeyPairSigner
let supporterKeys: ConfidentialKeys
let creatorKeys: ConfidentialKeys
let supporterToken: Address
let creatorToken: Address

const elgamalAddress = (k: ConfidentialKeys) =>
  getAddressDecoder().decode(k.elgamal().pubkey().toBytes())

type CtExtension = Extract<Extension, { __kind: 'ConfidentialTransferAccount' }>

function ctExtension(k: ConfidentialKeys, available: bigint): CtExtension {
  const pubkey = k.elgamal().pubkey()
  return {
    __kind: 'ConfidentialTransferAccount',
    approved: true,
    elgamalPubkey: elgamalAddress(k),
    pendingBalanceLow: pubkey.encryptU64(0n).toBytes(),
    pendingBalanceHigh: pubkey.encryptU64(0n).toBytes(),
    availableBalance: pubkey.encryptU64(available).toBytes(),
    decryptableAvailableBalance: k.ae().encrypt(available).toBytes(),
    allowConfidentialCredits: true,
    allowNonConfidentialCredits: true,
    pendingBalanceCreditCounter: 0n,
    maximumPendingBalanceCreditCounter: 65_536n,
    expectedPendingBalanceCreditCounter: 0n,
    actualPendingBalanceCreditCounter: 0n,
  }
}

function tokenAccount(owner: Address, ext: CtExtension): Token {
  return {
    mint: MINT,
    owner,
    amount: 0n,
    delegate: none(),
    state: AccountState.Initialized,
    isNative: none(),
    delegatedAmount: 0n,
    closeAuthority: none(),
    extensions: some([ext]),
  }
}

function encodeMint(): ReadonlyUint8Array {
  const auditor = new ElGamalKeypair()
  return getMintEncoder().encode({
    mintAuthority: none(),
    supply: 0n,
    decimals: DECIMALS,
    isInitialized: true,
    freezeAuthority: none(),
    extensions: some([
      extension('ConfidentialTransferMint', {
        authority: none(),
        autoApproveNewAccounts: true,
        auditorElgamalPubkey: some(getAddressDecoder().decode(auditor.pubkey().toBytes())),
      }),
    ]),
  })
}

type RpcCall = { method: string; params: unknown }

function rpcWith(accounts: Map<Address, ReadonlyUint8Array>, calls: RpcCall[] = []) {
  const transport: RpcTransport = async <T>({ payload }: { payload: unknown }) => {
    const { method, params } = payload as { method: string; params: unknown[] }
    calls.push({ method, params })
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: 1, result }) as T
    if (method === 'getMinimumBalanceForRentExemption') return reply(1_000_000)
    if (method !== 'getMultipleAccounts') throw new Error(`unexpected rpc call ${method}`)
    const [addresses] = params as [string[]]
    const value = addresses.map((a) => {
      const data = accounts.get(address(a))
      return data
        ? {
            data: [getBase64Decoder().decode(data), 'base64'],
            executable: false,
            lamports: 1,
            owner: TOKEN_2022_PROGRAM_ADDRESS,
            rentEpoch: 0,
            space: data.length,
          }
        : null
    })
    return reply({ context: { slot: 1 }, value })
  }
  return createSolanaRpcFromTransport(transport)
}

const kindOf = (ix: Instruction): string => {
  const data = ix.data ?? new Uint8Array()
  switch (ix.programAddress) {
    // `identifyZkElGamalProofInstruction` є лише в типах пакета; дискримінатор — перший байт.
    case ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS:
      return `zk:${ZkElGamalProofInstruction[data[0] ?? -1]}`
    case RECORD_PROGRAM_ADDRESS:
      return `record:${RecordInstruction[identifyRecordInstruction(data)]}`
    case SYSTEM_PROGRAM_ADDRESS:
      return `system:${SystemInstruction[identifySystemInstruction(data)]}`
    default:
      return ix.programAddress
  }
}

// Дзеркало білого переліку relay (PLAN, T025): усе, що не тут, relay відхилить.
const RELAY_ALLOWED = new Set([
  'zk:CloseContextState',
  'zk:VerifyCiphertextCommitmentEquality',
  'zk:VerifyBatchedGroupedCiphertext3HandlesValidity',
  'zk:VerifyBatchedRangeProofU128',
  'record:Initialize',
  'record:Write',
  'record:CloseAccount',
  'system:CreateAccount',
])

let contribution: Contribution
const calls: RpcCall[] = []

async function build(
  overrides: Partial<Parameters<typeof buildContribution>[0]> = {},
  log: RpcCall[] = [],
) {
  const rpc = rpcWith(
    new Map<Address, ReadonlyUint8Array>([
      [
        supporterToken,
        getTokenEncoder().encode(
          tokenAccount(supporter.address, ctExtension(supporterKeys, AVAILABLE)),
        ),
      ],
      [
        creatorToken,
        getTokenEncoder().encode(tokenAccount(creator.address, ctExtension(creatorKeys, 0n))),
      ],
      [MINT, encodeMint()],
    ]),
    log,
  )
  return buildContribution({
    rpc,
    keys: supporterKeys,
    supporter,
    creator: creator.address,
    mint: MINT,
    units: UNITS,
    periods: 3,
    showPublicly: true,
    payer: PAYER,
    ...overrides,
  })
}

beforeAll(async () => {
  supporter = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(7))
  creator = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(8))
  supporterKeys = await deriveConfidentialKeys(supporter, supporter.address, MINT)
  creatorKeys = await deriveConfidentialKeys(creator, creator.address, MINT)
  const tokenProgram = TOKEN_2022_PROGRAM_ADDRESS
  ;[supporterToken] = await findAssociatedTokenPda({
    owner: supporter.address,
    mint: MINT,
    tokenProgram,
  })
  ;[creatorToken] = await findAssociatedTokenPda({
    owner: creator.address,
    mint: MINT,
    tokenProgram,
  })
  contribution = await build({}, calls)
}, 30_000)

describe('buildContribution', () => {
  it('reads both token accounts and the mint in a single RPC request', () => {
    const reads = calls.filter((c) => c.method === 'getMultipleAccounts')
    expect(reads).toHaveLength(1)
  })

  it('stages 1..4 proof transactions the platform pays for, using only relay-allowed programs', () => {
    expect(contribution.proofs.length).toBeGreaterThanOrEqual(1)
    expect(contribution.proofs.length).toBeLessThanOrEqual(4)
    for (const message of contribution.proofs) {
      expect(message.feePayer.address).toBe(PAYER)
      for (const ix of message.instructions) expect(RELAY_ALLOWED).toContain(kindOf(ix))
    }
    const kinds = contribution.proofs.flatMap((m) => m.instructions.map(kindOf))
    expect(kinds).toContain('zk:VerifyCiphertextCommitmentEquality')
    expect(kinds).toContain('zk:VerifyBatchedGroupedCiphertext3HandlesValidity')
    expect(kinds).toContain('zk:VerifyBatchedRangeProofU128')
  })

  it('keeps the record chain in dependency order: create → write → verify', () => {
    const kinds = contribution.proofs.flatMap((m) => m.instructions.map(kindOf))
    const init = kinds.indexOf('record:Initialize')
    const write = kinds.indexOf('record:Write')
    const verify = kinds.indexOf('zk:VerifyBatchedRangeProofU128')
    expect(init).toBeGreaterThanOrEqual(0)
    expect(write).toBeGreaterThan(init)
    expect(verify).toBeGreaterThan(write)
  })

  it('puts Transfer and pledge in one supporter-paid transaction', async () => {
    const { transfer } = contribution
    expect(transfer.feePayer.address).toBe(supporter.address)
    expect(transfer.instructions).toHaveLength(2)
    const [transferIx, pledgeIx] = transfer.instructions
    if (!transferIx || !pledgeIx) throw new Error('unreachable')

    expect(transferIx.programAddress).toBe(TOKEN_2022_PROGRAM_ADDRESS)
    expect([transferIx.data?.[0], transferIx.data?.[1]]).toEqual([27, 7])
    const accounts = transferIx.accounts ?? []
    expect(accounts[0]?.address).toBe(supporterToken)
    expect(accounts[1]?.address).toBe(MINT)
    expect(accounts[2]?.address).toBe(creatorToken)
    expect(accounts.at(-1)?.address).toBe(supporter.address)

    expect(pledgeIx.programAddress).toBe(CCSUPPORT_PROGRAM_ADDRESS)
    const parsed = parseMakePledgeInstruction({
      ...pledgeIx,
      accounts: pledgeIx.accounts ?? [],
      data: pledgeIx.data ?? new Uint8Array(),
    })
    expect(parsed.data.periods).toBe(3)
    expect(parsed.data.showPublicly).toBe(true)
    expect(parsed.accounts.supporter.address).toBe(supporter.address)
    expect(parsed.accounts.creator.address).toBe((await creatorPda(creator.address))[0])
    expect(parsed.accounts.pledge.address).toBe(
      (await pledgePda(creator.address, supporter.address))[0],
    )
  })

  it('fits the signed Transfer + pledge transaction into the network limit', async () => {
    const tx = await signTransactionMessageWithSigners(
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: BLOCKHASH, lastValidBlockHeight: 1n },
        contribution.transfer,
      ),
    )
    const size = getTransactionSize(tx)
    expect(size).toBeLessThanOrEqual(TX_SIZE_LIMIT)
    // 5 нових акаунтів проти 4 у заглушці T006 (System program під `init_if_needed`) = +33 B,
    // дані 10 B проти 13 B = −3 B.
    expect(size).toBe(TRANSFER_WITH_PLEDGE_BYTES_T006 + 33 - 3)
  })

  it('closes the context-state accounts and the record on the platform account', () => {
    expect(contribution.close.length).toBeGreaterThanOrEqual(1)
    expect(contribution.close.length).toBeLessThanOrEqual(2)
    const kinds = contribution.close.flatMap((m) => m.instructions.map(kindOf))
    expect(kinds.filter((k) => k === 'zk:CloseContextState')).toHaveLength(3)
    expect(kinds.filter((k) => k === 'record:CloseAccount')).toHaveLength(1)
    for (const message of contribution.close) {
      expect(message.feePayer.address).toBe(PAYER)
      for (const ix of message.instructions) expect(RELAY_ALLOWED).toContain(kindOf(ix))
    }
  })

  it('rejects periods outside 1..12 before touching the network', async () => {
    const log: RpcCall[] = []
    await expect(build({ periods: 13 }, log)).rejects.toThrow(RangeError)
    expect(log).toHaveLength(0)
  })

  it('rejects a contribution above the available confidential balance', async () => {
    await expect(build({ units: AVAILABLE + 1n })).rejects.toThrow(/insufficient/i)
  })
})

describe('signForRelay', () => {
  it('signs every ephemeral account and leaves the platform signature empty', async () => {
    const wires = await Promise.all(
      [...contribution.proofs, ...contribution.close].map((m) =>
        signForRelay(m, { blockhash: BLOCKHASH, lastValidBlockHeight: 1n }),
      ),
    )
    for (const wire of wires) {
      const bytes = getBase64Encoder().encode(wire)
      expect(bytes.length).toBeLessThanOrEqual(TX_SIZE_LIMIT)
      const tx = getTransactionDecoder().decode(bytes)
      const entries = Object.entries(tx.signatures)
      expect(entries[0]?.[0]).toBe(PAYER)
      expect(entries[0]?.[1]).toBeNull()
      for (const [, sig] of entries.slice(1)) expect(sig).not.toBeNull()
    }
  })
})
