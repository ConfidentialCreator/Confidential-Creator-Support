import { MAX_PERIODS } from '@ccsupport/shared'
import type { Address, TransactionSigner } from '@solana/kit'
import {
  getInitConfigInstructionAsync,
  getMakePledgeInstructionAsync,
  getRegisterCreatorInstructionAsync,
  getSetVisibilityInstruction,
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

// The u8 encoder writes `undefined` as 0 — the program would answer 6008 only after the
// signature and the fee, so the bound is checked here.
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

export type SetVisibilityParams = {
  supporter: TransactionSigner
  creatorWallet: Address
  showPublicly: boolean
}

export async function setVisibilityInstruction({
  supporter,
  creatorWallet,
  showPublicly,
}: SetVisibilityParams) {
  const [pledge] = await pledgePda(creatorWallet, supporter.address)
  return getSetVisibilityInstruction({ supporter, pledge, showPublicly })
}
