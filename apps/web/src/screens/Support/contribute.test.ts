import type {
  ConfidentialKeys,
  Contribution,
  ContributionMessage,
  Preparation,
} from '@ccsupport/chain'
import {
  type Address,
  address,
  appendTransactionMessageInstruction,
  type Base64EncodedWireTransaction,
  blockhash,
  createNoopSigner,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  type Instruction,
  pipe,
  type ReadonlyUint8Array,
  type Signature,
  type SignatureBytes,
  setTransactionMessageFeePayerSigner,
  type TransactionSendingSigner,
} from '@solana/kit'
import { describe, expect, it } from 'vitest'
import type { ChainPort, SignatureStatus } from '../Register/submit.ts'
import {
  type ChainOps,
  type ContributionRequest,
  type Ports,
  type Progress,
  type Relay,
  runContribution,
} from './contribute.ts'

const WALLET = address('6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk')
const CREATOR = address('AJ6LFWEJgLEwkfyWWipZ8Le5fV9QjCV61UCnzv9g5ZUq')
const PAYER = address('2gVkYWexTHR5Hb2aLeQN3tnngvWzisFKXDUPrgMHpdST')
const MINT = address('6f1QTLNPh59wM26CQx1pnJTUcE814H64JaABjARPvtiC')
const PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const BLOCKHASH = blockhash('9zwFRXGrRTvgmxRvMyBYyGqYr8WLrN5rBmhdEcGB5b9A')

const walletSig = (n: number): SignatureBytes => new Uint8Array(64).fill(n) as SignatureBytes
const b58 = (bytes: SignatureBytes) => getBase58Decoder().decode(bytes) as Signature
const relaySig = (n: number) => `relay-${n}` as Signature

const memo = (text: string): Instruction => ({
  programAddress: PROGRAM,
  data: new TextEncoder().encode(text),
})

function message(feePayer: Address | TransactionSendingSigner, text: string): ContributionMessage {
  const signer = typeof feePayer === 'string' ? createNoopSigner(feePayer) : feePayer
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => appendTransactionMessageInstruction(memo(text), m),
  )
}

type Harness = {
  ports: Ports
  request: ContributionRequest
  sent: ReadonlyUint8Array[]
  relayed: { mode: 'proofs' | 'close'; wires: Base64EncodedWireTransaction[] }[]
  calls: string[]
  progress: Progress[]
}

type Options = {
  steps?: Preparation['steps']
  planError?: Error
  statuses?: SignatureStatus[]
  closeError?: Error
}

function harness(options: Options = {}): Harness {
  const sent: ReadonlyUint8Array[] = []
  const relayed: Harness['relayed'] = []
  const calls: string[] = []
  const progress: Progress[] = []
  let walletCalls = 0

  const supporter: TransactionSendingSigner = {
    address: WALLET,
    signAndSendTransactions: async (transactions) => {
      calls.push('wallet')
      return transactions.map((t) => {
        sent.push(t.messageBytes)
        walletCalls += 1
        return walletSig(walletCalls)
      })
    },
  }

  const ops: ChainOps = {
    account: async () => {
      calls.push('account')
      return { token: WALLET, account: null, decimals: 6 }
    },
    plan: async () => {
      calls.push('plan')
      if (options.planError) throw options.planError
      return { token: WALLET, steps: options.steps ?? [], deposit: 0n }
    },
    build: async (): Promise<Contribution> => {
      calls.push('build')
      return {
        proofs: [message(PAYER, 'equality'), message(PAYER, 'validity'), message(PAYER, 'range')],
        transfer: message(supporter, 'transfer+pledge'),
        close: [message(PAYER, 'close')],
      }
    },
  }

  const statuses = options.statuses ?? ['confirmed']
  let asked = 0
  const port: ChainPort = {
    latestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }),
    signatureStatus: async () => {
      calls.push('status')
      asked += 1
      return statuses[Math.min(asked, statuses.length) - 1] ?? 'pending'
    },
  }

  const relay: Relay = {
    proofs: async (wires) => {
      calls.push('relay:proofs')
      relayed.push({ mode: 'proofs', wires })
      return wires.map((_, i) => relaySig(i))
    },
    close: async (wires) => {
      calls.push('relay:close')
      if (options.closeError) throw options.closeError
      relayed.push({ mode: 'close', wires })
      return wires.map((_, i) => relaySig(10 + i))
    },
  }

  return {
    ports: { ops, port, relay, onProgress: (p) => progress.push(p) },
    request: {
      keys: {} as ConfidentialKeys,
      supporter,
      creator: CREATOR,
      mint: MINT,
      units: 7_250_000n,
      periods: 3,
      showPublicly: false,
      payer: PAYER,
    },
    sent,
    relayed,
    calls,
    progress,
  }
}

describe('runContribution', () => {
  it('runs a prepared wallet through proofs, one signed transfer and close', async () => {
    const h = harness()
    const outcome = await runContribution(h.ports, h.request, 1)

    expect(outcome.preparation).toBeNull()
    expect(outcome.transfer).toBe(b58(walletSig(1)))
    expect(outcome.proofs).toEqual([relaySig(0), relaySig(1), relaySig(2)])
    expect(outcome.close).toEqual([relaySig(10)])
    expect(outcome.closeError).toBeNull()
    expect(outcome.signatures).toBe(2)
    expect(h.sent).toHaveLength(1)
    expect(h.relayed.map((r) => [r.mode, r.wires.length])).toEqual([
      ['proofs', 3],
      ['close', 1],
    ])
    expect(h.calls).toEqual([
      'account',
      'plan',
      'build',
      'relay:proofs',
      'wallet',
      'status',
      'relay:close',
    ])
    expect(h.progress.map((p) => p.stage)).toEqual([
      'plan',
      'proofs',
      'transfer',
      'confirm',
      'close',
    ])
  })

  it('sends the preparation as one wallet transaction and waits for it before building', async () => {
    const h = harness({
      steps: [
        { kind: 'configure', instructions: [memo('configure')] },
        { kind: 'deposit', instructions: [memo('deposit')] },
        { kind: 'apply', instructions: [memo('apply')] },
      ],
    })
    const outcome = await runContribution(h.ports, h.request, 0)

    expect(outcome.preparation).toBe(b58(walletSig(1)))
    expect(outcome.transfer).toBe(b58(walletSig(2)))
    expect(outcome.signatures).toBe(2)
    expect(h.sent).toHaveLength(2)
    expect(h.calls.slice(0, 5)).toEqual(['account', 'plan', 'wallet', 'status', 'build'])
    expect(h.progress.map((p) => p.stage)).toEqual([
      'plan',
      'prepare',
      'confirm',
      'proofs',
      'transfer',
      'confirm',
      'close',
    ])
    expect(h.progress.map((p) => p.signatures)).toEqual([0, 0, 1, 1, 1, 2, 2])
  })

  it('surfaces insufficient funds before the wallet is asked for anything', async () => {
    const h = harness({ planError: new Error('insufficient funds: 2250000 more units are needed') })
    await expect(runContribution(h.ports, h.request, 1)).rejects.toThrow(/insufficient funds/)
    expect(h.sent).toHaveLength(0)
    expect(h.relayed).toHaveLength(0)
  })

  it('keeps the contribution when only the close stage fails', async () => {
    const h = harness({ closeError: new Error('relay: RATE_LIMITED') })
    const outcome = await runContribution(h.ports, h.request, 1)
    expect(outcome.transfer).toBe(b58(walletSig(1)))
    expect(outcome.close).toEqual([])
    expect(outcome.closeError).toMatch(/RATE_LIMITED/)
  })

  it('fails without closing when the transfer fails on chain', async () => {
    const h = harness({ statuses: ['failed'] })
    await expect(runContribution(h.ports, h.request, 1)).rejects.toThrow(/failed on chain/)
    expect(h.calls).not.toContain('relay:close')
  })

  it('relays the proof transactions with the payer unsigned and the fresh blockhash', async () => {
    const h = harness()
    await runContribution(h.ports, h.request, 1)
    const wire = h.relayed[0]?.wires[0]
    expect(wire).toBeDefined()
    if (!wire) return
    const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
    expect(Object.keys(transaction.signatures)).toEqual([PAYER])
    expect(transaction.signatures[PAYER]).toBeNull()
  })
})
