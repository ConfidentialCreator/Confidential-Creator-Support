import {
  buildContribution,
  type ConfidentialKeys,
  type Contribution,
  type ContributionInput,
  type ContributionMessage,
  fetchConfidentialAccount,
  type Preparation,
  type PreparationInput,
  planPreparation,
  relayClose,
  relayProofs,
  signForRelay,
} from '@ccsupport/chain'
import {
  type Address,
  appendTransactionMessageInstructions,
  type Base64EncodedWireTransaction,
  createTransactionMessage,
  getBase58Decoder,
  pipe,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
  type TransactionSendingSigner,
} from '@solana/kit'
import { type ChainPort, waitConfirmed } from '../Register/submit.ts'
import type { Stage } from './flow.ts'

export type TokenAccount = Awaited<ReturnType<typeof fetchConfidentialAccount>>

export type ChainOps = {
  account(owner: Address, mint: Address): Promise<TokenAccount>
  plan(
    account: TokenAccount['account'],
    decimals: number,
    input: Omit<PreparationInput, 'rpc'>,
  ): Promise<Preparation>
  build(input: Omit<ContributionInput, 'rpc'>): Promise<Contribution>
}

export const chainOps = (rpc: Rpc<SolanaRpcApi>): ChainOps => ({
  account: (owner, mint) => fetchConfidentialAccount(rpc, owner, mint),
  plan: (account, decimals, input) => planPreparation(account, decimals, { rpc, ...input }),
  build: (input) => buildContribution({ rpc, ...input }),
})

export type Relay = {
  proofs(wires: Base64EncodedWireTransaction[]): Promise<Signature[]>
  close(wires: Base64EncodedWireTransaction[]): Promise<Signature[]>
}

export const apiRelay = (apiUrl: string): Relay => ({
  proofs: (wires) => relayProofs(apiUrl, wires),
  close: (wires) => relayClose(apiUrl, wires),
})

export type Progress = { stage: Stage; signatures: number }

export type Ports = {
  ops: ChainOps
  port: ChainPort
  relay: Relay
  onProgress(progress: Progress): void
}

export type ContributionRequest = {
  keys: ConfidentialKeys
  supporter: TransactionSendingSigner
  creator: Address
  mint: Address
  units: bigint
  periods: number
  showPublicly: boolean
  payer: Address
}

export type Outcome = {
  preparation: Signature | null
  proofs: Signature[]
  transfer: Signature
  close: Signature[]
  // The contribution stands once the transfer is confirmed; a failed close only
  // leaves the proof accounts' rent with the platform.
  closeError: string | null
  signatures: number
}

async function sendWithWallet(port: ChainPort, message: ContributionMessage): Promise<Signature> {
  const lifetime = await port.latestBlockhash()
  const bytes = await signAndSendTransactionMessageWithSigners(
    setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
  )
  return getBase58Decoder().decode(bytes) as Signature
}

// One blockhash for the whole batch: the relay sends and confirms them in order,
// well within the blockhash lifetime.
async function relayBatch(
  port: ChainPort,
  messages: ContributionMessage[],
  send: (wires: Base64EncodedWireTransaction[]) => Promise<Signature[]>,
): Promise<Signature[]> {
  if (messages.length === 0) return []
  const lifetime = await port.latestBlockhash()
  const wires = await Promise.all(messages.map((m) => signForRelay(m, lifetime)))
  return send(wires)
}

export async function runContribution(
  ports: Ports,
  request: ContributionRequest,
  signatures: number,
): Promise<Outcome> {
  const { ops, port, relay } = ports
  const { keys, supporter, mint, units } = request
  let signed = signatures
  const progress = (stage: Stage) => ports.onProgress({ stage, signatures: signed })

  progress('plan')
  const { account, decimals } = await ops.account(supporter.address, mint)
  const preparation = await ops.plan(account, decimals, { owner: supporter, mint, keys, units })

  let preparationSignature: Signature | null = null
  if (preparation.steps.length > 0) {
    progress('prepare')
    preparationSignature = await sendWithWallet(
      port,
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(supporter, m),
        (m) =>
          appendTransactionMessageInstructions(
            preparation.steps.flatMap((step) => step.instructions),
            m,
          ),
      ),
    )
    signed += 1
    progress('confirm')
    await waitConfirmed(port, preparationSignature)
  }

  const contribution = await ops.build({
    keys,
    supporter,
    creator: request.creator,
    mint,
    units,
    periods: request.periods,
    showPublicly: request.showPublicly,
    payer: request.payer,
  })
  progress('proofs')
  const proofs = await relayBatch(port, contribution.proofs, relay.proofs)

  progress('transfer')
  const transfer = await sendWithWallet(port, contribution.transfer)
  signed += 1
  progress('confirm')
  await waitConfirmed(port, transfer)

  progress('close')
  let close: Signature[] = []
  let closeError: string | null = null
  try {
    close = await relayBatch(port, contribution.close, relay.close)
  } catch (err) {
    closeError = err instanceof Error ? err.message : String(err)
  }

  return {
    preparation: preparationSignature,
    proofs,
    transfer,
    close,
    closeError,
    signatures: signed,
  }
}
