import { configPda, fetchMaybeConfig, initConfigInstruction } from '@ccsupport/chain'
import {
  type Address,
  type GetAccountInfoApi,
  type InstructionPlan,
  type KeyPairSigner,
  type Rpc,
  singleInstructionPlan,
} from '@solana/kit'

export type InitConfigInput = { authority: KeyPairSigner; mint: Address }

export type ExistingConfig = { address: Address; mint: Address; authority: Address }

// `init` on the PDA makes a second call fail after the fee: look first, so the
// operator can rerun the command after a partial deploy without a failed transaction.
export async function findConfig(rpc: Rpc<GetAccountInfoApi>): Promise<ExistingConfig | null> {
  const [address] = await configPda()
  const account = await fetchMaybeConfig(rpc, address)
  if (!account.exists) return null
  return { address, mint: account.data.mint, authority: account.data.authority }
}

export async function initConfigPlan({
  authority,
  mint,
}: InitConfigInput): Promise<InstructionPlan> {
  return singleInstructionPlan(await initConfigInstruction({ authority, mint }))
}
