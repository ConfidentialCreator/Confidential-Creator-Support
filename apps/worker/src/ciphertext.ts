import { extractValidityContext } from '@ccsupport/chain'
import {
  type Address,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from '@solana/kit'

export type RecipientCiphertext = { groupedLo: Uint8Array; groupedHi: Uint8Array; proofSig: string }

// Signatures come newest first, as `getSignaturesForAddress` lists them.
export type ChainReader = {
  wire: (signature: string) => Promise<string | null>
  signaturesFor: (address: Address) => Promise<string[]>
  blockTime: (signature: string) => Promise<number | null>
}

const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const CONFIDENTIAL_TRANSFER_EXTENSION = 27
const VALIDITY_CONTEXT_ACCOUNT = 4

export function validityContextAddress(wire: string): Address | null {
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
  if (!('instructions' in message)) return null
  const transfer = message.instructions.find(
    (ix) =>
      message.staticAccounts[ix.programAddressIndex] === TOKEN_2022 &&
      ix.data?.[0] === CONFIDENTIAL_TRANSFER_EXTENSION,
  )
  const index = transfer?.accountIndices?.[VALIDITY_CONTEXT_ACCOUNT]
  return index === undefined ? null : (message.staticAccounts[index] ?? null)
}

async function wireOf(chain: ChainReader, signature: string): Promise<string> {
  const wire = await chain.wire(signature)
  if (wire === null) throw new Error(`transaction ${signature} is not served yet`)
  return wire
}

// The Transfer carries only the auditor's ciphertext and the validity context-state
// is closed right after it, so the recipient's ciphertext survives only in the proof
// transaction that created that account — the oldest one in the account's history.
export async function fetchRecipientCiphertext(
  chain: ChainReader,
  transferSignature: string,
): Promise<RecipientCiphertext> {
  const context = validityContextAddress(await wireOf(chain, transferSignature))
  if (context === null) {
    throw new Error(`transaction ${transferSignature} carries no confidential Transfer`)
  }
  const history = await chain.signaturesFor(context)
  for (const signature of [...history].reverse()) {
    const validity = extractValidityContext(await wireOf(chain, signature))
    if (validity !== null) return { ...validity, proofSig: signature }
  }
  throw new Error(`no validity proof transaction found for context ${context}`)
}

export function chainReader(rpc: Rpc<SolanaRpcApi>): ChainReader {
  return {
    wire: async (signature) => {
      const tx = await rpc
        .getTransaction(signature as Signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
          encoding: 'base64',
        })
        .send()
      return tx === null ? null : tx.transaction[0]
    },
    signaturesFor: async (address) => {
      const page = await rpc.getSignaturesForAddress(address, { commitment: 'confirmed' }).send()
      return page.map((info) => info.signature)
    },
    blockTime: async (signature) => {
      const tx = await rpc
        .getTransaction(signature as Signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
          encoding: 'base64',
        })
        .send()
      return tx?.blockTime == null ? null : Number(tx.blockTime)
    },
  }
}
