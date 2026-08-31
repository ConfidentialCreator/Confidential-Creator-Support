import {
  AccountRole,
  type Address,
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createSolanaRpcFromTransport,
  getAddressDecoder,
  getBase64Decoder,
  type Instruction,
  type KeyPairSigner,
  none,
  type ReadonlyUint8Array,
  type RpcTransport,
  some,
} from '@solana/kit'
import { AeCiphertext, type ConfidentialKeys } from '@solana/zk-sdk'
import {
  AccountState,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  type Extension,
  findAssociatedTokenPda,
  getMintEncoder,
  getTokenEncoder,
  identifyToken2022Instruction,
  parseApplyConfidentialPendingBalanceInstruction,
  parseConfidentialDepositInstruction,
  parseConfigureConfidentialTransferAccountInstruction,
  parseCreateAssociatedTokenIdempotentInstruction,
  parseReallocateInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Token,
  Token2022Instruction,
} from '@solana-program/token-2022'
import { ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS } from '@solana-program/zk-elgamal-proof'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  confidentialAccountState,
  fetchConfidentialAccount,
  isConfigured,
  type PreparationStep,
  planPreparation,
} from './account.ts'
import { deriveConfidentialKeys } from './keys.ts'

const MINT = address('6f1QTLNPh59wM26CQx1pnJTUcE814H64JaABjARPvtiC')
const DECIMALS = 6
const PUBLIC = 25_000_000n
const UNITS = 7_250_000n
const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111')
// Жоден тест не має ходити в мережу: адреса без сервера падає при першому виклику.
const deadRpc = createSolanaRpc('http://127.0.0.1:1')

let owner: KeyPairSigner
let keys: ConfidentialKeys
let foreignKeys: ConfidentialKeys
let token: Address

const elgamalAddress = (k: ConfidentialKeys) =>
  getAddressDecoder().decode(k.elgamal().pubkey().toBytes())

type CtExtension = Extract<Extension, { __kind: 'ConfidentialTransferAccount' }>

function ctExtension(
  k: ConfidentialKeys,
  balances: { available: bigint; pending: bigint; counter: bigint },
): CtExtension {
  const pubkey = k.elgamal().pubkey()
  return {
    __kind: 'ConfidentialTransferAccount',
    approved: true,
    elgamalPubkey: elgamalAddress(k),
    pendingBalanceLow: pubkey.encryptU64(balances.pending & 0xffffn).toBytes(),
    pendingBalanceHigh: pubkey.encryptU64(balances.pending >> 16n).toBytes(),
    availableBalance: pubkey.encryptU64(balances.available).toBytes(),
    decryptableAvailableBalance: k.ae().encrypt(balances.available).toBytes(),
    allowConfidentialCredits: true,
    allowNonConfidentialCredits: true,
    pendingBalanceCreditCounter: balances.counter,
    maximumPendingBalanceCreditCounter: 65_536n,
    expectedPendingBalanceCreditCounter: 0n,
    actualPendingBalanceCreditCounter: 0n,
  }
}

function tokenAccount(publicBalance: bigint, extension?: CtExtension): Token {
  return {
    mint: MINT,
    owner: owner.address,
    amount: publicBalance,
    delegate: none(),
    state: AccountState.Initialized,
    isNative: none(),
    delegatedAmount: 0n,
    closeAuthority: none(),
    extensions: extension ? some([extension]) : none(),
  }
}

const kinds = (steps: PreparationStep[]) => steps.map((s) => s.kind)
const only = (step: PreparationStep | undefined) => {
  const ix = step?.instructions[0]
  if (!ix || step.instructions.length !== 1) throw new Error('expected exactly one instruction')
  return ix
}
// Парсери SDK хочуть обов'язкові `accounts`/`data`, у типі `Instruction` вони optional.
const parts = (ix: Instruction) => ({
  ...ix,
  accounts: ix.accounts ?? [],
  data: ix.data ?? new Uint8Array(),
})
const ixKinds = (step: PreparationStep) =>
  step.instructions.map((ix) =>
    ix.programAddress === TOKEN_2022_PROGRAM_ADDRESS
      ? Token2022Instruction[identifyToken2022Instruction(parts(ix))]
      : ix.programAddress,
  )

beforeAll(async () => {
  owner = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(7))
  const stranger = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(9))
  keys = await deriveConfidentialKeys(owner, owner.address, MINT)
  foreignKeys = await deriveConfidentialKeys(stranger, stranger.address, MINT)
  ;[token] = await findAssociatedTokenPda({
    owner: owner.address,
    mint: MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  })
})

describe('confidentialAccountState', () => {
  it('reports a missing ATA', () => {
    expect(confidentialAccountState(null)).toEqual({ kind: 'missing' })
  })

  it('reports an ATA without the confidential extension', () => {
    expect(confidentialAccountState(tokenAccount(PUBLIC))).toEqual({
      kind: 'unconfigured',
      publicBalance: PUBLIC,
    })
  })

  it('reports a configured ATA with its ElGamal key', () => {
    const ext = ctExtension(keys, { available: 0n, pending: 0n, counter: 0n })
    expect(confidentialAccountState(tokenAccount(PUBLIC, ext))).toEqual({
      kind: 'configured',
      publicBalance: PUBLIC,
      approved: true,
      elgamalPubkey: elgamalAddress(keys),
      extension: ext,
    })
  })
})

describe('planPreparation', () => {
  const plan = (account: Token | null, units: bigint, deposit?: bigint) =>
    planPreparation(account, DECIMALS, {
      rpc: deadRpc,
      owner,
      mint: MINT,
      keys,
      units,
      ...(deposit === undefined ? {} : { deposit }),
    })

  it('configures a missing ATA in one transaction when nothing has to be deposited', async () => {
    const result = await plan(null, 0n)

    expect(result.token).toBe(token)
    expect(result.deposit).toBe(0n)
    expect(kinds(result.steps)).toEqual(['configure'])
    const [configure] = result.steps
    if (!configure) throw new Error('unreachable')
    expect(ixKinds(configure)).toEqual([
      ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      'Reallocate',
      'ConfigureConfidentialTransferAccount',
      ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
    ])
    const [create, reallocate, configureIx, verify] = configure.instructions
    if (!create || !reallocate || !configureIx || !verify) throw new Error('unreachable')

    const parsedCreate = parseCreateAssociatedTokenIdempotentInstruction(parts(create))
    expect(parsedCreate.accounts.payer.address).toBe(owner.address)
    expect(parsedCreate.accounts.ata.address).toBe(token)
    expect(parsedCreate.accounts.mint.address).toBe(MINT)

    const parsedRealloc = parseReallocateInstruction(parts(reallocate))
    expect(parsedRealloc.accounts.payer.address).toBe(owner.address)
    expect(parsedRealloc.accounts.owner.address).toBe(owner.address)

    const parsed = parseConfigureConfidentialTransferAccountInstruction(parts(configureIx))
    expect(parsed.accounts.token.address).toBe(token)
    expect(parsed.accounts.authority.address).toBe(owner.address)
    expect(parsed.accounts.authority.role).toBe(AccountRole.READONLY_SIGNER)
    expect(parsed.accounts.instructionsSysvarOrContextState?.address).toBe(INSTRUCTIONS_SYSVAR)
    expect(parsed.data.proofInstructionOffset).toBe(1)
    expect(parsed.data.maximumPendingBalanceCreditCounter).toBe(65_536n)
    expect(keys.ae().decrypt(AeCiphertextOf(parsed.data.decryptableZeroBalance))).toBe(0n)
    // pubkey-validity інлайн: доказ у наступній інструкції, а не в context-state акаунті
    expect(verify.data?.[0]).toBe(4)
    expect(verify.accounts ?? []).toHaveLength(0)
  })

  it('refuses when the public balance cannot cover the contribution', async () => {
    await expect(plan(null, UNITS)).rejects.toThrow(/insufficient/)
    await expect(plan(tokenAccount(UNITS - 1n), UNITS)).rejects.toThrow(/insufficient/)
  })

  it('builds configure → deposit → apply for a fresh ATA with a public balance', async () => {
    const result = await plan(tokenAccount(PUBLIC), UNITS)

    expect(kinds(result.steps)).toEqual(['configure', 'deposit', 'apply'])
    expect(result.deposit).toBe(PUBLIC)
    const [, deposit, apply] = result.steps
    if (!deposit || !apply) throw new Error('unreachable')
    expect(ixKinds(deposit)).toEqual(['ConfidentialDeposit'])
    expect(ixKinds(apply)).toEqual(['ApplyConfidentialPendingBalance'])

    const parsedDeposit = parseConfidentialDepositInstruction(parts(only(deposit)))
    expect(parsedDeposit.accounts.token.address).toBe(token)
    expect(parsedDeposit.accounts.mint.address).toBe(MINT)
    expect(parsedDeposit.accounts.authority.address).toBe(owner.address)
    expect(parsedDeposit.accounts.authority.role).toBe(AccountRole.READONLY_SIGNER)
    expect(parsedDeposit.data.amount).toBe(PUBLIC)
    expect(parsedDeposit.data.decimals).toBe(DECIMALS)

    const parsedApply = parseApplyConfidentialPendingBalanceInstruction(parts(only(apply)))
    expect(parsedApply.accounts.token.address).toBe(token)
    expect(parsedApply.accounts.authority.address).toBe(owner.address)
    expect(parsedApply.data.expectedPendingBalanceCreditCounter).toBe(1n)
    expect(keys.ae().decrypt(AeCiphertextOf(parsedApply.data.newDecryptableAvailableBalance))).toBe(
      PUBLIC,
    )
  })

  it('deposits only the requested part when the caller narrows it', async () => {
    const ext = ctExtension(keys, { available: 0n, pending: 0n, counter: 0n })
    const result = await plan(tokenAccount(PUBLIC, ext), UNITS, 10_000_000n)

    expect(kinds(result.steps)).toEqual(['deposit', 'apply'])
    expect(result.deposit).toBe(10_000_000n)
    const [deposit, apply] = result.steps
    if (!deposit || !apply) throw new Error('unreachable')
    expect(parseConfidentialDepositInstruction(parts(only(deposit))).data.amount).toBe(10_000_000n)
    const parsedApply = parseApplyConfidentialPendingBalanceInstruction(parts(only(apply)))
    expect(parsedApply.data.expectedPendingBalanceCreditCounter).toBe(1n)
    expect(keys.ae().decrypt(AeCiphertextOf(parsedApply.data.newDecryptableAvailableBalance))).toBe(
      10_000_000n,
    )
  })

  it('rejects a deposit outside [shortfall, publicBalance]', async () => {
    const ext = ctExtension(keys, { available: 0n, pending: 0n, counter: 0n })
    await expect(plan(tokenAccount(PUBLIC, ext), UNITS, PUBLIC + 1n)).rejects.toThrow(
      /exceeds the public balance/,
    )
    await expect(plan(tokenAccount(PUBLIC, ext), UNITS, UNITS - 1n)).rejects.toThrow(/insufficient/)
  })

  it('only applies a pending balance that already covers the contribution', async () => {
    const ext = ctExtension(keys, { available: 1_000_000n, pending: 6_250_000n, counter: 3n })
    const result = await plan(tokenAccount(0n, ext), UNITS)

    expect(kinds(result.steps)).toEqual(['apply'])
    expect(result.deposit).toBe(0n)
    const parsedApply = parseApplyConfidentialPendingBalanceInstruction(
      parts(only(result.steps[0])),
    )
    expect(parsedApply.data.expectedPendingBalanceCreditCounter).toBe(3n)
    expect(keys.ae().decrypt(AeCiphertextOf(parsedApply.data.newDecryptableAvailableBalance))).toBe(
      UNITS,
    )
  })

  it('needs nothing when the available balance already covers the contribution', async () => {
    const ext = ctExtension(keys, { available: UNITS, pending: 0n, counter: 1n })
    const result = await plan(tokenAccount(0n, ext), UNITS)
    expect(result.steps).toEqual([])
    expect(result.deposit).toBe(0n)
  })

  it('refuses an ATA configured with a foreign ElGamal key', async () => {
    const ext = ctExtension(foreignKeys, { available: 0n, pending: 0n, counter: 0n })
    await expect(plan(tokenAccount(PUBLIC, ext), UNITS)).rejects.toThrow(/ElGamal/)
  })

  it('refuses an ATA the mint has not approved', async () => {
    const ext = {
      ...ctExtension(keys, { available: 0n, pending: 0n, counter: 0n }),
      approved: false,
    }
    await expect(plan(tokenAccount(PUBLIC, ext), UNITS)).rejects.toThrow(/approved/)
  })
})

describe('fetchConfidentialAccount / isConfigured', () => {
  const encodeMint = () =>
    getMintEncoder().encode({
      mintAuthority: none(),
      supply: 0n,
      decimals: DECIMALS,
      isInitialized: true,
      freezeAuthority: none(),
      extensions: none(),
    })

  function rpcWith(accounts: Map<Address, ReadonlyUint8Array>) {
    const transport: RpcTransport = async <T>({ payload }: { payload: unknown }) => {
      const [addresses] = (payload as { params: [string[]] }).params
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
      return { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value } } as T
    }
    return createSolanaRpcFromTransport(transport)
  }

  it('decodes the ATA and the mint decimals in one request', async () => {
    const ext = ctExtension(keys, { available: 0n, pending: 0n, counter: 0n })
    const rpc = rpcWith(
      new Map([
        [token, getTokenEncoder().encode(tokenAccount(PUBLIC, ext))],
        [MINT, encodeMint()],
      ]),
    )
    const fetched = await fetchConfidentialAccount(rpc, owner.address, MINT)
    expect(fetched.token).toBe(token)
    expect(fetched.decimals).toBe(DECIMALS)
    expect(fetched.account?.amount).toBe(PUBLIC)
    expect(confidentialAccountState(fetched.account).kind).toBe('configured')
    expect(await isConfigured(rpc, owner.address, MINT)).toBe(true)
  })

  it('treats a missing ATA as not configured', async () => {
    const rpc = rpcWith(new Map([[MINT, encodeMint()]]))
    const fetched = await fetchConfidentialAccount(rpc, owner.address, MINT)
    expect(fetched.account).toBeNull()
    expect(await isConfigured(rpc, owner.address, MINT)).toBe(false)
  })

  it('fails loudly when the mint does not exist', async () => {
    await expect(fetchConfidentialAccount(rpcWith(new Map()), owner.address, MINT)).rejects.toThrow(
      /mint/,
    )
  })
})

function AeCiphertextOf(bytes: ArrayLike<number>): AeCiphertext {
  const ciphertext = AeCiphertext.fromBytes(new Uint8Array(bytes))
  if (!ciphertext) throw new Error('not an AES ciphertext')
  return ciphertext
}
