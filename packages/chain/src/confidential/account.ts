import {
  type Address,
  fetchEncodedAccounts,
  type GetMinimumBalanceForRentExemptionApi,
  type GetMultipleAccountsApi,
  getAddressDecoder,
  type Instruction,
  type InstructionPlan,
  isSome,
  type Rpc,
  type TransactionSigner,
} from '@solana/kit'
import { AeCiphertext, type ConfidentialKeys, ElGamalCiphertext } from '@solana/zk-sdk'
import {
  decodeMint,
  decodeToken,
  type Extension,
  findAssociatedTokenPda,
  getApplyConfidentialPendingBalanceInstruction,
  getConfidentialDepositInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Token,
} from '@solana-program/token-2022'
import { getCreateConfidentialTransferAccountInstructionPlan } from '@solana-program/token-2022/confidential'

type CtExtension = Extract<Extension, { __kind: 'ConfidentialTransferAccount' }>

export type ConfidentialAccountState =
  | { kind: 'missing' }
  | { kind: 'unconfigured'; publicBalance: bigint }
  | {
      kind: 'configured'
      publicBalance: bigint
      approved: boolean
      elgamalPubkey: Address
      extension: CtExtension
    }

export type PreparationInput = {
  rpc: Rpc<GetMinimumBalanceForRentExemptionApi>
  owner: TransactionSigner
  mint: Address
  keys: ConfidentialKeys
  // How much must be available after preparation (the upcoming contribution).
  units: bigint
  // How much to take from the public balance; by default all of it, so that later
  // contributions need no Deposit + ApplyPendingBalance.
  deposit?: bigint
}

export type PreparationStep = {
  kind: 'configure' | 'deposit' | 'apply'
  instructions: Instruction[]
}

export type Preparation = {
  token: Address
  steps: PreparationStep[]
  deposit: bigint
}

export function confidentialAccountState(account: Token | null): ConfidentialAccountState {
  if (!account) return { kind: 'missing' }
  const extension = isSome(account.extensions)
    ? account.extensions.value.find(
        (e): e is CtExtension => e.__kind === 'ConfidentialTransferAccount',
      )
    : undefined
  if (!extension) return { kind: 'unconfigured', publicBalance: account.amount }
  return {
    kind: 'configured',
    publicBalance: account.amount,
    approved: extension.approved,
    elgamalPubkey: extension.elgamalPubkey,
    extension,
  }
}

export async function fetchConfidentialAccount(
  rpc: Rpc<GetMultipleAccountsApi>,
  owner: Address,
  mint: Address,
): Promise<{ token: Address; account: Token | null; decimals: number }> {
  const [token] = await findAssociatedTokenPda({
    owner,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  })
  const [encodedToken, encodedMint] = await fetchEncodedAccounts<[string, string]>(rpc, [
    token,
    mint,
  ])
  const mintAccount = decodeMint(encodedMint)
  if (!mintAccount.exists) throw new Error(`mint ${mint} does not exist`)
  const tokenAccount = decodeToken(encodedToken)
  return {
    token,
    account: tokenAccount.exists ? tokenAccount.data : null,
    decimals: mintAccount.data.decimals,
  }
}

export async function isConfigured(
  rpc: Rpc<GetMultipleAccountsApi>,
  owner: Address,
  mint: Address,
): Promise<boolean> {
  const state = confidentialAccountState((await fetchConfidentialAccount(rpc, owner, mint)).account)
  return state.kind === 'configured' && state.approved
}

const PENDING_LO_BITS = 16n

function decryptBalances(extension: CtExtension, keys: ConfidentialKeys) {
  const decryptable = AeCiphertext.fromBytes(new Uint8Array(extension.decryptableAvailableBalance))
  const lo = ElGamalCiphertext.fromBytes(new Uint8Array(extension.pendingBalanceLow))
  const hi = ElGamalCiphertext.fromBytes(new Uint8Array(extension.pendingBalanceHigh))
  if (!decryptable || !lo || !hi) throw new Error('confidential balances do not parse')
  const secret = keys.elgamal().secret()
  return {
    available: keys.ae().decrypt(decryptable),
    pending: secret.decrypt(lo) + (secret.decrypt(hi) << PENDING_LO_BITS),
  }
}

function flatten(plan: InstructionPlan): Instruction[] {
  switch (plan.kind) {
    case 'single':
      return [plan.instruction]
    case 'sequential':
    case 'parallel':
      return plan.plans.flatMap(flatten)
    case 'messagePacker':
      throw new Error('unexpected message-packer plan')
  }
}

export async function planPreparation(
  account: Token | null,
  decimals: number,
  input: PreparationInput,
): Promise<Preparation> {
  const state = confidentialAccountState(account)
  const [token] = await findAssociatedTokenPda({
    owner: input.owner.address,
    mint: input.mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  })
  const steps: PreparationStep[] = []
  let available = 0n
  let pending = 0n
  let counter = 0n
  let publicBalance = 0n

  if (state.kind === 'configured') {
    const ours = getAddressDecoder().decode(input.keys.elgamal().pubkey().toBytes())
    if (state.elgamalPubkey !== ours) {
      throw new Error(`token account ${token} is configured with a foreign ElGamal key`)
    }
    if (!state.approved) throw new Error(`token account ${token} is not approved by the mint`)
    ;({ available, pending } = decryptBalances(state.extension, input.keys))
    counter = state.extension.pendingBalanceCreditCounter
    publicBalance = state.publicBalance
  } else {
    if (state.kind === 'unconfigured') publicBalance = state.publicBalance
    steps.push({
      kind: 'configure',
      instructions: flatten(
        await getCreateConfidentialTransferAccountInstructionPlan({
          rpc: input.rpc,
          payer: input.owner,
          owner: input.owner,
          mint: input.mint,
          token,
          elgamalKeypair: input.keys.elgamal(),
          aesKey: input.keys.ae(),
        }),
      ),
    })
  }

  const shortfall = input.units - available - pending
  const deposit = input.deposit ?? publicBalance
  if (deposit > publicBalance) {
    throw new Error(`deposit ${deposit} exceeds the public balance ${publicBalance}`)
  }
  if (deposit < shortfall) {
    throw new Error(`insufficient funds: ${shortfall - deposit} more units are needed`)
  }
  if (deposit > 0n) {
    steps.push({
      kind: 'deposit',
      instructions: [
        getConfidentialDepositInstruction({
          token,
          mint: input.mint,
          authority: input.owner,
          amount: deposit,
          decimals,
        }),
      ],
    })
  }
  if (pending + deposit > 0n) {
    steps.push({
      kind: 'apply',
      instructions: [
        getApplyConfidentialPendingBalanceInstruction({
          token,
          authority: input.owner,
          expectedPendingBalanceCreditCounter: counter + (deposit > 0n ? 1n : 0n),
          newDecryptableAvailableBalance: input.keys
            .ae()
            .encrypt(available + pending + deposit)
            .toBytes(),
        }),
      ],
    })
  }
  return { token, steps, deposit }
}
