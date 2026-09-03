import {
  type Address,
  type Base64EncodedWireTransaction,
  type Blockhash,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  generateKeyPair,
  getAddressFromPublicKey,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  pipe,
  type Signature,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
  SolanaError,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Transaction,
} from '@solana/kit'
import { describe, expect, it } from 'vitest'
import {
  CONFIRM_TIMEOUT_MS,
  createRelayPayer,
  type PayerRpc,
  type SignatureStatus,
} from './payer.ts'

const BLOCKHASH = blockhash('9zwFRXGrRTvgmxRvMyBYyGqYr8WLrN5rBmhdEcGB5b9A')

const decodeWire = (wire: string) =>
  getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(wire)))

const keyPair = await generateKeyPair()
const payerAddress = await getAddressFromPublicKey(keyPair.publicKey)

function unsignedTransaction(feePayer: Address = payerAddress): Transaction {
  return compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(feePayer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: BLOCKHASH, lastValidBlockHeight: 1n },
          m,
        ),
    ),
  )
}

type FakeRpc = PayerRpc & {
  sent: Base64EncodedWireTransaction[]
  checkedBlockhashes: Blockhash[]
  polls: number
}

// `statuses` is consumed one per poll; the last one repeats.
function fakeRpc(
  statuses: (SignatureStatus | null)[],
  options: { blockhashValid?: boolean; send?: () => Promise<Signature> } = {},
): FakeRpc {
  const rpc: FakeRpc = {
    sent: [],
    checkedBlockhashes: [],
    polls: 0,
    async sendTransaction(wire) {
      rpc.sent.push(wire)
      if (options.send) return options.send()
      return getSignatureFromTransaction(decodeWire(wire))
    },
    async getSignatureStatus() {
      const status = statuses[Math.min(rpc.polls, statuses.length - 1)] ?? null
      rpc.polls += 1
      return status
    },
    async isBlockhashValid(hash) {
      rpc.checkedBlockhashes.push(hash)
      return options.blockhashValid ?? true
    },
    async getBalance() {
      return 123n
    },
  }
  return rpc
}

const confirmed: SignatureStatus = { confirmationStatus: 'confirmed', err: null }
const processed: SignatureStatus = { confirmationStatus: 'processed', err: null }

function clock() {
  let now = 0
  const sleeps: number[] = []
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      now += ms
    },
    sleeps,
  }
}

async function payerWith(rpc: PayerRpc, options: { pollMs?: number; timeoutMs?: number } = {}) {
  const c = clock()
  const payer = await createRelayPayer(rpc, keyPair, { ...options, now: c.now, sleep: c.sleep })
  return { payer, ...c }
}

describe('createRelayPayer', () => {
  it('exposes the address of the key pair and its balance', async () => {
    const rpc = fakeRpc([confirmed])
    const { payer } = await payerWith(rpc)
    expect(payer.address).toBe(payerAddress)
    expect(await payer.lamports()).toBe(123n)
  })

  it('signs the fee payer slot, sends the wire and polls until confirmed', async () => {
    const rpc = fakeRpc([null, processed, confirmed])
    const { payer, sleeps } = await payerWith(rpc, { pollMs: 250 })
    const transaction = unsignedTransaction()

    const result = await payer.submit(transaction)

    expect(result.ok).toBe(true)
    expect(rpc.sent).toHaveLength(1)
    const sent = decodeWire(rpc.sent[0] ?? '')
    expect(sent.signatures[payerAddress]).toHaveLength(64)
    expect(sent.messageBytes).toEqual(transaction.messageBytes)
    if (result.ok) expect(result.signature).toBe(getSignatureFromTransaction(sent))
    expect(rpc.polls).toBe(3)
    expect(sleeps).toEqual([250, 250])
    // The blockhash is only checked while the network has not seen the signature yet.
    expect(rpc.checkedBlockhashes).toEqual([BLOCKHASH])
  })

  it('accepts a finalized status too', async () => {
    const rpc = fakeRpc([{ confirmationStatus: 'finalized', err: null }])
    const { payer } = await payerWith(rpc)
    expect((await payer.submit(unsignedTransaction())).ok).toBe(true)
  })

  it('rejects when the transaction failed on chain', async () => {
    const rpc = fakeRpc([
      { confirmationStatus: 'confirmed', err: { InstructionError: [0, 'InvalidArgument'] } },
    ])
    const { payer } = await payerWith(rpc)
    const result = await payer.submit(unsignedTransaction())
    expect(result).toEqual({
      ok: false,
      kind: 'rejected',
      reason: expect.stringMatching(/failed on chain.*InvalidArgument/),
    })
  })

  it('rejects when the blockhash expires before the network sees the signature', async () => {
    const rpc = fakeRpc([null], { blockhashValid: false })
    const { payer, sleeps } = await payerWith(rpc)
    const result = await payer.submit(unsignedTransaction())
    expect(result).toEqual({
      ok: false,
      kind: 'rejected',
      reason: expect.stringMatching(/expired/),
    })
    expect(sleeps).toEqual([])
  })

  it('rejects on a preflight failure with the cause in the reason', async () => {
    const preflight = new SolanaError(
      SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
      {
        accounts: null,
        cause: new SolanaError(SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND),
        fee: null,
        loadedAccountsDataSize: null,
        loadedAddresses: null,
        logs: [],
        postBalances: null,
        postTokenBalances: null,
        preBalances: null,
        preTokenBalances: null,
        replacementBlockhash: null,
        returnData: null,
        unitsConsumed: 0n,
      },
    )
    const rpc = fakeRpc([confirmed], { send: () => Promise.reject(preflight) })
    const { payer } = await payerWith(rpc)
    const result = await payer.submit(unsignedTransaction())
    expect(result).toEqual({
      ok: false,
      kind: 'rejected',
      reason: expect.stringMatching(/simulation failed.*Blockhash not found/i),
    })
    expect(rpc.polls).toBe(0)
  })

  it('fails when the rpc is unreachable', async () => {
    const rpc = fakeRpc([confirmed], { send: () => Promise.reject(new Error('ECONNREFUSED')) })
    const { payer } = await payerWith(rpc)
    expect(await payer.submit(unsignedTransaction())).toEqual({
      ok: false,
      kind: 'failed',
      reason: 'ECONNREFUSED',
    })
  })

  it('fails when confirmation does not arrive before the timeout', async () => {
    const rpc = fakeRpc([processed])
    const { payer, sleeps } = await payerWith(rpc, { pollMs: 1_000, timeoutMs: 3_000 })
    const result = await payer.submit(unsignedTransaction())
    expect(result).toEqual({ ok: false, kind: 'failed', reason: expect.stringMatching(/3000 ms/) })
    expect(sleeps).toEqual([1_000, 1_000, 1_000])
    expect(CONFIRM_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000)
  })
})
