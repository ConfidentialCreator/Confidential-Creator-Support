import { registerCreatorInstruction } from '@ccsupport/chain'
import {
  address,
  blockhash,
  getBase58Decoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type ReadonlyUint8Array,
  type Signature,
  type SignatureBytes,
  type TransactionSendingSigner,
} from '@solana/kit'
import { describe, expect, it } from 'vitest'
import {
  type ChainPort,
  CONFIRM_ATTEMPTS,
  type SignatureStatus,
  sendInstruction,
  waitConfirmed,
} from './submit.ts'

const WALLET = address('6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk')
const BLOCKHASH = blockhash('9zwFRXGrRTvgmxRvMyBYyGqYr8WLrN5rBmhdEcGB5b9A')
const SIG_BYTES = new Uint8Array(64).fill(9) as SignatureBytes
const SIG = getBase58Decoder().decode(SIG_BYTES) as Signature

function port(statuses: SignatureStatus[]): ChainPort & { asked: number } {
  const p = {
    asked: 0,
    latestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }),
    signatureStatus: async () => {
      p.asked += 1
      return statuses[Math.min(p.asked, statuses.length) - 1] ?? 'pending'
    },
  }
  return p
}

function walletSigner() {
  const sent: ReadonlyUint8Array[] = []
  const signer: TransactionSendingSigner = {
    address: WALLET,
    signAndSendTransactions: async (transactions) => {
      for (const t of transactions) sent.push(t.messageBytes)
      return transactions.map(() => SIG_BYTES)
    },
  }
  return { signer, sent }
}

describe('sendInstruction', () => {
  it('hands the wallet one v0 transaction paid by it, with the fresh blockhash', async () => {
    const { signer, sent } = walletSigner()
    const instruction = await registerCreatorInstruction({
      wallet: signer,
      handle: 'marrow-dispatch',
      name: 'Ilse Marrow',
      description: 'Port cities.',
    })
    const signature = await sendInstruction(port([]), signer, instruction)
    expect(signature).toBe(SIG)
    const [bytes] = sent
    if (!bytes) throw new Error('nothing sent')
    const message = getCompiledTransactionMessageDecoder().decode(bytes)
    expect(message.version).toBe(0)
    expect(message.staticAccounts[0]).toBe(WALLET)
    expect(message.lifetimeToken).toBe(BLOCKHASH)
    expect('instructions' in message ? message.instructions : []).toHaveLength(1)
    // The wallet signs; nothing here does.
    expect(() => getTransactionDecoder().decode(bytes)).toThrow()
  })
})

describe('waitConfirmed', () => {
  const noSleep = async () => {}

  it('returns once the signature is confirmed', async () => {
    const p = port(['pending', 'pending', 'confirmed'])
    await waitConfirmed(p, SIG, noSleep)
    expect(p.asked).toBe(3)
  })

  it('throws when the chain reports the transaction as failed', async () => {
    await expect(waitConfirmed(port(['failed']), SIG, noSleep)).rejects.toThrow(/failed on chain/)
  })

  it('gives up after CONFIRM_ATTEMPTS polls', async () => {
    const p = port(['pending'])
    await expect(waitConfirmed(p, SIG, noSleep)).rejects.toThrow(/not confirmed in time/)
    expect(p.asked).toBe(CONFIRM_ATTEMPTS)
  })
})
