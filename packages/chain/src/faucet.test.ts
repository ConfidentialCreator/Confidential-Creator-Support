import {
  AccountRole,
  type Address,
  address,
  createSolanaRpcFromTransport,
  getBase64Decoder,
  type Instruction,
  none,
  type ReadonlyUint8Array,
  type RpcTransport,
} from '@solana/kit'
import { parseTransferSolInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system'
import {
  AccountState,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getMintEncoder,
  getTokenEncoder,
  parseCreateAssociatedTokenIdempotentInstruction,
  parseTransferInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022'
import { describe, expect, it } from 'vitest'
import { buildFaucetTopUp, fetchPublicBalance } from './faucet.ts'

const FAUCET = address('AJ6LFWEJgLEwkfyWWipZ8Le5fV9QjCV61UCnzv9g5ZUq')
const WALLET = address('D4TkDq52FCqPyvwgQWBDepBumsYKB5ZjroRLfGckrYnQ')
const MINT = address('6f1QTLNPh59wM26CQx1pnJTUcE814H64JaABjARPvtiC')

// Парсери SDK хочуть обов'язкові `accounts`/`data`, у типі `Instruction` вони optional.
const parts = (ix: Instruction) => ({
  programAddress: ix.programAddress,
  accounts: ix.accounts ?? [],
  data: ix.data ?? new Uint8Array(),
})

const ata = async (owner: Address) =>
  (await findAssociatedTokenPda({ owner, mint: MINT, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }))[0]

describe('buildFaucetTopUp', () => {
  it('moves SOL, creates the wallet ATA idempotently and transfers the token, faucet signing all', async () => {
    const instructions = await buildFaucetTopUp({
      faucet: FAUCET,
      wallet: WALLET,
      mint: MINT,
      lamports: 20_000_000n,
      units: 100_000_000n,
    })
    expect(instructions.map((ix) => ix.programAddress)).toEqual([
      SYSTEM_PROGRAM_ADDRESS,
      ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      TOKEN_2022_PROGRAM_ADDRESS,
    ])
    const [sol, create, transfer] = instructions.map(parts)
    if (!sol || !create || !transfer) throw new Error('expected three instructions')

    const parsedSol = parseTransferSolInstruction(sol)
    expect(parsedSol.accounts.source.address).toBe(FAUCET)
    expect(parsedSol.accounts.destination.address).toBe(WALLET)
    expect(parsedSol.data.amount).toBe(20_000_000n)

    const parsedCreate = parseCreateAssociatedTokenIdempotentInstruction(create)
    expect(parsedCreate.accounts.payer.address).toBe(FAUCET)
    expect(parsedCreate.accounts.owner.address).toBe(WALLET)
    expect(parsedCreate.accounts.ata.address).toBe(await ata(WALLET))
    expect(parsedCreate.accounts.mint.address).toBe(MINT)
    expect(parsedCreate.accounts.tokenProgram.address).toBe(TOKEN_2022_PROGRAM_ADDRESS)

    const parsedTransfer = parseTransferInstruction(transfer)
    expect(parsedTransfer.accounts.source.address).toBe(await ata(FAUCET))
    expect(parsedTransfer.accounts.destination.address).toBe(await ata(WALLET))
    expect(parsedTransfer.accounts.authority.address).toBe(FAUCET)
    expect(parsedTransfer.data.amount).toBe(100_000_000n)

    const signers = instructions.flatMap((ix) =>
      (ix.accounts ?? [])
        .filter(
          (a) => a.role === AccountRole.WRITABLE_SIGNER || a.role === AccountRole.READONLY_SIGNER,
        )
        .map((a) => a.address),
    )
    expect(new Set(signers)).toEqual(new Set([FAUCET]))
  })

  it('refuses zero portions', async () => {
    const input = { faucet: FAUCET, wallet: WALLET, mint: MINT }
    await expect(buildFaucetTopUp({ ...input, lamports: 0n, units: 1n })).rejects.toThrow(
      /lamports/,
    )
    await expect(buildFaucetTopUp({ ...input, lamports: 1n, units: 0n })).rejects.toThrow(/units/)
  })
})

describe('fetchPublicBalance', () => {
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

  const mint = getMintEncoder().encode({
    mintAuthority: none(),
    supply: 0n,
    decimals: 6,
    isInitialized: true,
    freezeAuthority: none(),
    extensions: none(),
  })

  it('reads the public balance of the ATA', async () => {
    const token = getTokenEncoder().encode({
      mint: MINT,
      owner: FAUCET,
      amount: 12_800_000_000n,
      delegate: none(),
      state: AccountState.Initialized,
      isNative: none(),
      delegatedAmount: 0n,
      closeAuthority: none(),
      extensions: none(),
    })
    const rpc = rpcWith(
      new Map([
        [await ata(FAUCET), token],
        [MINT, mint],
      ]),
    )
    expect(await fetchPublicBalance(rpc, FAUCET, MINT)).toBe(12_800_000_000n)
  })

  it('is zero when the ATA does not exist', async () => {
    const rpc = rpcWith(new Map([[MINT, mint]]))
    expect(await fetchPublicBalance(rpc, FAUCET, MINT)).toBe(0n)
  })
})
