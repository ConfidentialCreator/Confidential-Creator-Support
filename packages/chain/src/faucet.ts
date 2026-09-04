import {
  type Address,
  createNoopSigner,
  type GetMultipleAccountsApi,
  type Instruction,
  type Rpc,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022'
import { fetchConfidentialAccount } from './confidential/account.ts'

export type FaucetTopUpInput = {
  faucet: Address
  wallet: Address
  mint: Address
  lamports: bigint
  units: bigint
}

// Devnet only: the faucet wallet is an ordinary holder of the demo token, so this is
// a plain transfer — no mint authority is involved. The faucet signs everything
// (SOL, ATA rent, token); the caller adds that signature.
export async function buildFaucetTopUp({
  faucet,
  wallet,
  mint,
  lamports,
  units,
}: FaucetTopUpInput): Promise<Instruction[]> {
  if (lamports <= 0n) throw new Error('lamports must be positive')
  if (units <= 0n) throw new Error('units must be positive')
  const signer = createNoopSigner(faucet)
  const tokenProgram = TOKEN_2022_PROGRAM_ADDRESS
  const [[source], [destination]] = await Promise.all([
    findAssociatedTokenPda({ owner: faucet, mint, tokenProgram }),
    findAssociatedTokenPda({ owner: wallet, mint, tokenProgram }),
  ])
  return [
    getTransferSolInstruction({ source: signer, destination: wallet, amount: lamports }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer: signer,
      ata: destination,
      owner: wallet,
      mint,
      tokenProgram,
    }),
    getTransferInstruction(
      { source, destination, authority: signer, amount: units },
      { programAddress: tokenProgram },
    ),
  ]
}

export async function fetchPublicBalance(
  rpc: Rpc<GetMultipleAccountsApi>,
  owner: Address,
  mint: Address,
): Promise<bigint> {
  const { account } = await fetchConfidentialAccount(rpc, owner, mint)
  return account?.amount ?? 0n
}
