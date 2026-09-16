import {
  type Address,
  appendTransactionMessageInstructions,
  type Base64EncodedWireTransaction,
  type BlockhashLifetimeConstraint,
  createNoopSigner,
  createTransactionMessage,
  createTransactionPlanner,
  fetchEncodedAccounts,
  type GetAccountInfoApi,
  type GetMinimumBalanceForRentExemptionApi,
  type GetMultipleAccountsApi,
  getBase64EncodedWireTransaction,
  type InstructionPlan,
  partiallySignTransactionMessageWithSigners,
  pipe,
  type Rpc,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type TransactionMessage,
  type TransactionMessageWithFeePayer,
  type TransactionPlan,
  type TransactionSigner,
} from '@solana/kit'
import type { ConfidentialKeys } from '@solana/zk-sdk'
import {
  decodeMint,
  decodeToken,
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022'
import { getConfidentialTransferWithRecordInstructionPlan } from '@solana-program/token-2022/confidential'
import { pledgeInstruction } from '../program.ts'

export type ContributionMessage = TransactionMessage & TransactionMessageWithFeePayer

export type ContributionInput = {
  rpc: Rpc<GetMultipleAccountsApi & GetMinimumBalanceForRentExemptionApi & GetAccountInfoApi>
  keys: ConfidentialKeys
  supporter: TransactionSigner
  // The creator's wallet — the `Pledge` seed and the owner of the destination ATA.
  creator: Address
  mint: Address
  units: bigint
  periods: number
  showPublicly: boolean
  // The proof payer (relay); the server adds the signature, here it is a noop.
  payer: Address
}

// The three stages run in sequence and each takes its own blockhash at send time,
// so no lifetime is set here.
export type Contribution = {
  proofs: ContributionMessage[]
  transfer: ContributionMessage
  close: ContributionMessage[]
}

function messagesOf(plan: TransactionPlan): ContributionMessage[] {
  switch (plan.kind) {
    case 'single':
      return [plan.message]
    case 'sequential':
    case 'parallel':
      return plan.plans.flatMap(messagesOf)
  }
}

function splitTransferPlan(plan: InstructionPlan) {
  if (plan.kind !== 'sequential' || plan.plans.length !== 3) {
    throw new Error(`unexpected transfer plan shape: ${plan.kind}`)
  }
  const [setup, transfer, cleanup] = plan.plans
  if (!setup || !cleanup || transfer?.kind !== 'single') {
    throw new Error('unexpected transfer plan shape: middle plan is not the transfer')
  }
  return { setup, transfer: transfer.instruction, cleanup }
}

export async function buildContribution(input: ContributionInput): Promise<Contribution> {
  const pledge = await pledgeInstruction({
    supporter: input.supporter,
    creatorWallet: input.creator,
    periods: input.periods,
    showPublicly: input.showPublicly,
  })
  const tokenProgram = TOKEN_2022_PROGRAM_ADDRESS
  const [[sourceToken], [destinationToken]] = await Promise.all([
    findAssociatedTokenPda({ owner: input.supporter.address, mint: input.mint, tokenProgram }),
    findAssociatedTokenPda({ owner: input.creator, mint: input.mint, tokenProgram }),
  ])
  const [source, destination, mint] = await fetchEncodedAccounts<[string, string, string]>(
    input.rpc,
    [sourceToken, destinationToken, input.mint],
  )
  if (!source.exists) throw new Error(`supporter token account ${sourceToken} does not exist`)
  if (!destination.exists) {
    throw new Error(`creator token account ${destinationToken} does not exist`)
  }
  if (!mint.exists) throw new Error(`mint ${input.mint} does not exist`)

  const payer = createNoopSigner(input.payer)
  const { setup, transfer, cleanup } = splitTransferPlan(
    await getConfidentialTransferWithRecordInstructionPlan({
      rpc: input.rpc,
      payer,
      sourceToken,
      sourceTokenAccount: decodeToken(source).data,
      mint: input.mint,
      mintAccount: decodeMint(mint).data,
      destinationToken,
      destinationTokenAccount: decodeToken(destination).data,
      authority: input.supporter,
      amount: input.units,
      sourceElgamalKeypair: input.keys.elgamal(),
      aesKey: input.keys.ae(),
    }),
  )

  const planner = createTransactionPlanner({
    createTransactionMessage: () =>
      pipe(createTransactionMessage({ version: 0 }), (m) =>
        setTransactionMessageFeePayerSigner(payer, m),
      ),
  })
  return {
    proofs: messagesOf(await planner(setup)),
    transfer: pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(input.supporter, m),
      (m) => appendTransactionMessageInstructions([transfer, pledge], m),
    ),
    close: messagesOf(await planner(cleanup)),
  }
}

// Signs with the ephemeral keys of the context-state/Record accounts; the payer's
// signature stays empty — the relay adds it.
export async function signForRelay(
  message: ContributionMessage,
  lifetime: BlockhashLifetimeConstraint,
): Promise<Base64EncodedWireTransaction> {
  const signed = await partiallySignTransactionMessageWithSigners(
    setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
  )
  return getBase64EncodedWireTransaction(signed)
}
