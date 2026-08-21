import {
  type Address,
  type ClientWithGetMinimumBalance,
  getAddressDecoder,
  type InstructionPlan,
  type KeyPairSigner,
  none,
  some,
} from '@solana/kit'
import type { ElGamalPubkey } from '@solana/zk-sdk'
import { extension, getCreateMintInstructionPlan } from '@solana-program/token-2022'

export const TOKEN_NAME = 'Support Dollar'
export const TOKEN_SYMBOL = 'SUPD'
export const DECIMALS = 6

export function elgamalAddress(pubkey: ElGamalPubkey): Address {
  return getAddressDecoder().decode(pubkey.toBytes())
}

export type CreateMintInput = {
  authority: KeyPairSigner
  mint: KeyPairSigner
  auditor: ElGamalPubkey
}

export function createMintPlan(
  rent: ClientWithGetMinimumBalance,
  { authority, mint, auditor }: CreateMintInput,
): Promise<InstructionPlan> {
  return getCreateMintInstructionPlan(rent, {
    payer: authority,
    newMint: mint,
    decimals: DECIMALS,
    mintAuthority: authority,
    freezeAuthority: none(),
    extensions: [
      extension('ConfidentialTransferMint', {
        authority: some(authority.address),
        autoApproveNewAccounts: true,
        auditorElgamalPubkey: some(elgamalAddress(auditor)),
      }),
      extension('MetadataPointer', {
        authority: some(authority.address),
        metadataAddress: some(mint.address),
      }),
      extension('TokenMetadata', {
        updateAuthority: some(authority.address),
        mint: mint.address,
        name: TOKEN_NAME,
        symbol: TOKEN_SYMBOL,
        uri: '',
        additionalMetadata: new Map(),
      }),
    ],
  })
}
