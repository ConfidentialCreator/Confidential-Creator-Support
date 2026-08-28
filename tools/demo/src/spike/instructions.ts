import { CCSUPPORT_PROGRAM_ADDRESS } from '@ccsupport/chain'
import { AccountRole, type Address, getAddressDecoder, type Instruction } from '@solana/kit'
import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022'

// Anchor: 8 байт дискримінатора + periods u32 + show_publicly bool.
const PLEDGE_DATA_BYTES = 8 + 4 + 1

export function isConfidentialTransfer(ix: Instruction): boolean {
  return (
    ix.programAddress === TOKEN_2022_PROGRAM_ADDRESS &&
    ix.data?.[0] === CONFIDENTIAL_TRANSFER_DISCRIMINATOR &&
    ix.data[1] === CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR
  )
}

export function findConfidentialTransfer(instructions: readonly Instruction[]): number {
  return instructions.findIndex(isConfidentialTransfer)
}

// Заглушка `pledge` тієї ж ваги, що й справжня: program id, підписант-прихильник і
// `extraAccounts` акаунтів, яких у транзакції переказу ще немає (кожен — 32 байти).
export function syntheticPledge(supporter: Address, extraAccounts: number): Instruction {
  const decoder = getAddressDecoder()
  const extras = Array.from({ length: extraAccounts }, (_, i) => ({
    address: decoder.decode(new Uint8Array(32).fill(i + 1)),
    role: AccountRole.WRITABLE,
  }))
  return {
    programAddress: CCSUPPORT_PROGRAM_ADDRESS,
    accounts: [{ address: supporter, role: AccountRole.READONLY_SIGNER }, ...extras],
    data: new Uint8Array(PLEDGE_DATA_BYTES),
  }
}
