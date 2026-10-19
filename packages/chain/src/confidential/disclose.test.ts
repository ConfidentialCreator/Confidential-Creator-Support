import { readFileSync } from 'node:fs'
import {
  createSolanaRpcFromTransport,
  getBase58Encoder,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type RpcTransport,
  type Signature,
} from '@solana/kit'
import {
  BatchedGroupedCiphertext3HandlesValidityProofData,
  ElGamalKeypair,
  ElGamalPubkey,
  ElGamalSecretKey,
  GroupedElGamalCiphertext3Handles,
  PedersenOpening,
} from '@solana/zk-sdk'
import { getConfidentialTransferInstructionDataDecoder } from '@solana-program/token-2022'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { extractValidityContext } from './decrypt.ts'
import { createDisclosure, type DisclosedContribution, verifyDisclosure } from './disclose.ts'

const FIXTURE_DIR = new URL('../../../../fixtures/', import.meta.url)
const txSchema = z.object({ signature: z.string(), wire: z.string() })
const s1Schema = txSchema.extend({
  context: z.object({
    amount: z.string().regex(/^\d+$/),
    keys: z.object({ supporterElgamalSecret: z.string().regex(/^[0-9a-f]+$/) }),
  }),
})
const pledgeSchema = txSchema.extend({
  ciphertext: z.object({ proof: txSchema }),
})
const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, FIXTURE_DIR), 'utf8'))
const fromHex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'))

const transfer = s1Schema.parse(read('tx/transfer.json'))
const validityFixture = ['proof-1', 'proof-2', 'proof-3', 'proof-4']
  .map((name) => txSchema.parse(read(`tx/${name}.json`)))
  .find((f) => extractValidityContext(f.wire) !== null)
if (!validityFixture) throw new Error('no validity proof among the S1 fixtures')
const validityTx = validityFixture
const otherProofTx = txSchema.parse(read('tx/proof-1.json'))
const first = pledgeSchema.parse(read('logs/pledge-first.json'))
const renewal = pledgeSchema.parse(read('logs/pledge-renewal.json'))

const UNITS = BigInt(transfer.context.amount)
const supporterSecret = fromHex(transfer.context.keys.supporterElgamalSecret)
const supporter = ElGamalKeypair.fromSecretKey(ElGamalSecretKey.fromBytes(supporterSecret))

const sig = (s: string) => s as Signature
const contributionA: DisclosedContribution = {
  transferSignature: sig(transfer.signature),
  proofSignature: sig(validityTx.signature),
  proofWire: validityTx.wire,
}

type Served = { wire: string; err?: unknown }

function rpcServing(served: Map<string, Served>) {
  const transport: RpcTransport = async <T>({ payload }: { payload: unknown }) => {
    const [signature] = (payload as { params: [string] }).params
    const tx = served.get(signature)
    const result = tx
      ? {
          slot: 1,
          blockTime: 1,
          meta: { err: tx.err ?? null },
          transaction: [tx.wire, 'base64'],
          version: 0,
        }
      : null
    return { jsonrpc: '2.0', id: 1, result } as T
  }
  return createSolanaRpcFromTransport(transport)
}

const chainA = () =>
  new Map<string, Served>([
    [transfer.signature, { wire: transfer.wire }],
    [validityTx.signature, { wire: validityTx.wire }],
  ])

function replaceOnce(wire: string, from: Uint8Array, to: Uint8Array): string {
  const bytes = new Uint8Array(getBase64Encoder().encode(wire))
  const hits: number[] = []
  for (let i = 0; i + from.length <= bytes.length; i++) {
    if (from.every((b, j) => bytes[i + j] === b)) hits.push(i)
  }
  if (hits.length !== 1) throw new Error(`expected one occurrence, found ${hits.length}`)
  bytes.set(to, hits[0])
  return getBase64Decoder().decode(bytes)
}

function instructionData(wire: string, first: number, second?: number): Uint8Array {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
  if (!('instructions' in message)) throw new Error('no instructions')
  const ix = message.instructions.find(
    (i) => i.data?.[0] === first && (second === undefined || i.data[1] === second),
  )
  if (!ix?.data) throw new Error('instruction not found')
  return new Uint8Array(ix.data)
}

// The same supporter sends another contribution through the same validity account
// address: a fresh ciphertext of `units`, a valid proof for it, and a Transfer whose
// auditor commitments match. Signatures are not checked offline, so the wires keep the
// originals' signatures and only the RPC keys differ.
function anotherContribution(units: bigint) {
  const verifyData = instructionData(validityTx.wire, 12)
  const original = BatchedGroupedCiphertext3HandlesValidityProofData.fromBytes(verifyData.slice(1))
  const pubkeys = original.context().toBytes()
  const pubkey = (i: number) => ElGamalPubkey.fromBytes(pubkeys.slice(32 * i, 32 * (i + 1)))
  const [lo, hi] = [units & 0xffffn, units >> 16n]
  const [openingLo, openingHi] = [new PedersenOpening(), new PedersenOpening()]
  const grouped = (v: bigint, o: PedersenOpening) =>
    GroupedElGamalCiphertext3Handles.encryptWith(pubkey(0), pubkey(1), pubkey(2), v, o)
  const [groupedLo, groupedHi] = [grouped(lo, openingLo), grouped(hi, openingHi)]
  const proof = new BatchedGroupedCiphertext3HandlesValidityProofData(
    pubkey(0),
    pubkey(1),
    pubkey(2),
    groupedLo,
    groupedHi,
    lo,
    hi,
    openingLo,
    openingHi,
  )
  const proofWire = replaceOnce(validityTx.wire, verifyData.slice(1), proof.toBytes())

  const transferData = instructionData(transfer.wire, 27, 7)
  const decoded = getConfidentialTransferInstructionDataDecoder().decode(transferData)
  let transferWire = transfer.wire
  for (const [old, next] of [
    [decoded.transferAmountAuditorCiphertextLo, groupedLo],
    [decoded.transferAmountAuditorCiphertextHi, groupedHi],
  ] as const) {
    transferWire = replaceOnce(
      transferWire,
      new Uint8Array(old).slice(0, 32),
      next.toBytes().slice(0, 32),
    )
  }
  const contribution: DisclosedContribution = {
    transferSignature: sig(first.signature),
    proofSignature: sig(first.ciphertext.proof.signature),
    proofWire,
  }
  const served = new Map<string, Served>([
    [first.signature, { wire: transferWire }],
    [first.ciphertext.proof.signature, { wire: proofWire }],
  ])
  return { contribution, served }
}

const payloadBytes = (payload: string) =>
  Uint8Array.from(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))
const toPayload = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function created(contribution: DisclosedContribution, elgamal = supporter) {
  const result = createDisclosure(elgamal, contribution)
  if (!result.ok) throw new Error(`createDisclosure refused: ${result.reason}`)
  return result
}

describe('createDisclosure', () => {
  it('decrypts the own contribution and returns a URL-safe payload without keys', () => {
    const { payload, units } = created(contributionA)
    expect(units).toBe(UNITS)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
    const bytes = Buffer.from(payloadBytes(payload))
    expect(bytes.includes(Buffer.from(supporterSecret))).toBe(false)
  })

  it('refuses a key that cannot open the source ciphertext', () => {
    const stranger = ElGamalKeypair.fromSecretKey(
      ElGamalSecretKey.fromBytes(new Uint8Array(32).fill(7)),
    )
    expect(createDisclosure(stranger, contributionA)).toEqual({
      ok: false,
      reason: 'wrong-key',
    })
  })

  it('refuses a proof transaction without a validity proof', () => {
    expect(createDisclosure(supporter, { ...contributionA, proofWire: otherProofTx.wire })).toEqual(
      { ok: false, reason: 'malformed' },
    )
  })
})

describe('verifyDisclosure', () => {
  it('returns the amount of the disclosed contribution', async () => {
    const { payload } = created(contributionA)
    expect(await verifyDisclosure(payload, rpcServing(chainA()))).toEqual({
      ok: true,
      units: UNITS,
      transferSignature: transfer.signature,
    })
  })

  it('a second contribution of the same supporter discloses on its own', async () => {
    const b = anotherContribution(UNITS)
    const { payload } = created(b.contribution)
    expect(await verifyDisclosure(payload, rpcServing(b.served))).toMatchObject({
      ok: true,
      units: UNITS,
    })
  })

  it('a payload of one contribution does not verify another of the same supporter', async () => {
    const b = anotherContribution(UNITS)
    const retargeted = payloadBytes(created(contributionA).payload)
    retargeted.set(getBase58Encoder().encode(first.signature), 1)
    retargeted.set(getBase58Encoder().encode(first.ciphertext.proof.signature), 65)
    expect(await verifyDisclosure(toPayload(retargeted), rpcServing(b.served))).toEqual({
      ok: false,
      reason: 'proof-mismatch',
    })
  })

  it('discloses an amount beyond 2³² units', async () => {
    const units = 1n << 40n
    const b = anotherContribution(units)
    const { payload, units: disclosed } = created(b.contribution)
    expect(disclosed).toBe(units)
    expect(await verifyDisclosure(payload, rpcServing(b.served))).toMatchObject({
      ok: true,
      units,
    })
  })

  it('refuses a payload whose amount was raised by one', async () => {
    const bytes = payloadBytes(created(contributionA).payload)
    const view = new DataView(bytes.buffer)
    view.setBigUint64(129, view.getBigUint64(129, true) + 1n, true)
    expect(await verifyDisclosure(toPayload(bytes), rpcServing(chainA()))).toEqual({
      ok: false,
      reason: 'proof-mismatch',
    })
  })

  it('refuses a proof with one bit flipped', async () => {
    const bytes = payloadBytes(created(contributionA).payload)
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1
    expect(await verifyDisclosure(toPayload(bytes), rpcServing(chainA()))).toMatchObject({
      ok: false,
    })
  })

  it('refuses a proof transaction that did not write the Transfer’s validity account', async () => {
    const { payload } = created(contributionA)
    const chain = chainA()
    chain.set(validityTx.signature, { wire: renewal.ciphertext.proof.wire })
    expect(await verifyDisclosure(payload, rpcServing(chain))).toEqual({
      ok: false,
      reason: 'wrong-proof-transaction',
    })
  })

  it('refuses a validity proof whose commitments are not the Transfer’s', async () => {
    const { payload } = created(contributionA)
    const b = anotherContribution(UNITS)
    const chain = chainA()
    chain.set(validityTx.signature, { wire: b.contribution.proofWire })
    expect(await verifyDisclosure(payload, rpcServing(chain))).toEqual({
      ok: false,
      reason: 'ciphertext-mismatch',
    })
  })

  it('refuses a transaction that is not a confidential Transfer', async () => {
    const { payload } = created(contributionA)
    const chain = chainA()
    chain.set(transfer.signature, { wire: otherProofTx.wire })
    expect(await verifyDisclosure(payload, rpcServing(chain))).toEqual({
      ok: false,
      reason: 'not-a-transfer',
    })
  })

  it('refuses a transaction that failed on chain', async () => {
    const { payload } = created(contributionA)
    const chain = chainA()
    chain.set(transfer.signature, { wire: transfer.wire, err: { InstructionError: [0, 'X'] } })
    expect(await verifyDisclosure(payload, rpcServing(chain))).toEqual({
      ok: false,
      reason: 'failed-on-chain',
    })
  })

  it('refuses a transaction the RPC does not serve', async () => {
    const { payload } = created(contributionA)
    const chain = chainA()
    chain.delete(validityTx.signature)
    expect(await verifyDisclosure(payload, rpcServing(chain))).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })

  it.each([
    ['garbage', 'not a payload!'],
    ['truncated', created(contributionA).payload.slice(0, -4)],
    [
      'another version',
      toPayload(Uint8Array.of(2, ...payloadBytes(created(contributionA).payload).slice(1))),
    ],
  ])('refuses a %s payload without touching the RPC', async (_, payload) => {
    expect(await verifyDisclosure(payload, rpcServing(new Map()))).toEqual({
      ok: false,
      reason: 'malformed-payload',
    })
  })
})
