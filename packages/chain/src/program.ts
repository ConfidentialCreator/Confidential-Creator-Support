import { MAX_PERIODS } from '@ccsupport/shared'
import type { Address, TransactionSigner } from '@solana/kit'
import {
  getInitConfigInstructionAsync,
  getMakePledgeInstructionAsync,
  getRegisterCreatorInstructionAsync,
  getUpdateCreatorInstructionAsync,
} from './generated/index.ts'
import { creatorPda, handlePda, pledgePda } from './pda.ts'

export type InitConfigParams = { authority: TransactionSigner; mint: Address }

export const initConfigInstruction = (params: InitConfigParams) =>
  getInitConfigInstructionAsync(params)

export type RegisterCreatorParams = {
  wallet: TransactionSigner
  handle: string
  name: string
  description: string
}

export async function registerCreatorInstruction(params: RegisterCreatorParams) {
  const [handleAccount] = await handlePda(params.handle)
  return getRegisterCreatorInstructionAsync({ ...params, handleAccount })
}

export type UpdateCreatorParams = {
  wallet: TransactionSigner
  name: string
  description: string
  suggestedAmount: bigint
}

export const updateCreatorInstruction = (params: UpdateCreatorParams) =>
  getUpdateCreatorInstructionAsync(params)

export type PledgeParams = {
  supporter: TransactionSigner
  creatorWallet: Address
  periods: number
  showPublicly: boolean
}

// Кодер u8 пише `undefined` як 0 — програма відповіла б 6008 уже після підпису
// й комісії, тому межа перевіряється тут.
export async function pledgeInstruction({
  supporter,
  creatorWallet,
  periods,
  showPublicly,
}: PledgeParams) {
  if (!Number.isInteger(periods) || periods < 1 || periods > MAX_PERIODS) {
    throw new RangeError(`periods must be 1..${MAX_PERIODS}, got ${periods}`)
  }
  const [creator] = await creatorPda(creatorWallet)
  const [pledge] = await pledgePda(creatorWallet, supporter.address)
  return getMakePledgeInstructionAsync({ supporter, creator, pledge, periods, showPublicly })
}
