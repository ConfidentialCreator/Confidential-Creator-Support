import {
  appendTransactionMessageInstruction,
  type Blockhash,
  createTransactionMessage,
  getBase58Decoder,
  type Instruction,
  pipe,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
  type TransactionSendingSigner,
} from '@solana/kit'

export type SignatureStatus = 'pending' | 'confirmed' | 'failed'

export type ChainPort = {
  latestBlockhash: () => Promise<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>
  signatureStatus: (signature: Signature) => Promise<SignatureStatus>
}

export function chainPort(rpc: Rpc<SolanaRpcApi>): ChainPort {
  return {
    latestBlockhash: async () =>
      (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value,
    signatureStatus: async (signature) => {
      const [status] = (await rpc.getSignatureStatuses([signature]).send()).value
      if (!status) return 'pending'
      if (status.err) return 'failed'
      return status.confirmationStatus === 'processed' ? 'pending' : 'confirmed'
    },
  }
}

export async function sendInstruction(
  port: ChainPort,
  signer: TransactionSendingSigner,
  instruction: Instruction,
): Promise<Signature> {
  const lifetime = await port.latestBlockhash()
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstruction(instruction, m),
  )
  const bytes = await signAndSendTransactionMessageWithSigners(message)
  return getBase58Decoder().decode(bytes) as Signature
}

export const CONFIRM_POLL_MS = 1_500
export const CONFIRM_ATTEMPTS = 40

export async function waitConfirmed(
  port: ChainPort,
  signature: Signature,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
    const status = await port.signatureStatus(signature)
    if (status === 'confirmed') return
    if (status === 'failed') throw new Error(`transaction ${signature} failed on chain`)
    await sleep(CONFIRM_POLL_MS)
  }
  throw new Error(`transaction ${signature} was not confirmed in time`)
}
