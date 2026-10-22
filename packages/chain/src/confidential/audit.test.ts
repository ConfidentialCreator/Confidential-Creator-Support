import { readFileSync } from 'node:fs'
import {
  getBase58Encoder,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit'
import { ElGamalKeypair, ElGamalPubkey } from '@solana/zk-sdk'
import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  getConfidentialTransferInstructionDataDecoder,
} from '@solana-program/token-2022'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { decryptAsAuditor } from './audit.ts'

const FIXTURE_DIR = new URL('../../../../fixtures/', import.meta.url)
const hex = z.string().regex(/^[0-9a-f]+$/)
const transferSchema = z.object({
  wire: z.string(),
  context: z.object({
    amount: z.string().regex(/^\d+$/),
    auditorElgamalPubkey: z.string(),
    keys: z.object({ auditorElgamalSecret: hex, supporterElgamalSecret: hex }),
  }),
})
const wireSchema = z.object({ wire: z.string() })
const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, FIXTURE_DIR), 'utf8'))

const transfer = transferSchema.parse(read('tx/transfer.json'))
const proofTx = wireSchema.parse(read('tx/proof-2.json'))
const applyTx = wireSchema.parse(read('tx/apply.json'))
const livePledge = wireSchema.parse(read('logs/pledge-first.json'))

const UNITS = BigInt(transfer.context.amount)
const keyText = (secretHex: string) => JSON.stringify([...Buffer.from(secretHex, 'hex')])
const auditorKey = keyText(transfer.context.keys.auditorElgamalSecret)
const auditorBytes: number[] = JSON.parse(auditorKey)
const LO_BITS = 16n

function auditorCiphertexts(wire: string) {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
  if (!('instructions' in message)) throw new Error('no instructions')
  const ix = message.instructions.find(
    (i) =>
      i.data?.[0] === CONFIDENTIAL_TRANSFER_DISCRIMINATOR &&
      i.data[1] === CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  )
  if (!ix?.data) throw new Error('no Transfer instruction')
  const data = getConfidentialTransferInstructionDataDecoder().decode(ix.data)
  return {
    lo: new Uint8Array(data.transferAmountAuditorCiphertextLo),
    hi: new Uint8Array(data.transferAmountAuditorCiphertextHi),
  }
}

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

// Signatures are not checked offline, so fresh ciphertexts under the same auditor key
// stand in for a Transfer of an amount the S1 run did not send.
function withAuditorAmount(units: bigint): string {
  const pubkey = ElGamalPubkey.fromBytes(
    new Uint8Array(getBase58Encoder().encode(transfer.context.auditorElgamalPubkey)),
  )
  if (!pubkey) throw new Error('auditor pubkey does not parse')
  const { lo, hi } = auditorCiphertexts(transfer.wire)
  const swapped = replaceOnce(transfer.wire, lo, pubkey.encryptU64(units & 0xffffn).toBytes())
  return replaceOnce(swapped, hi, pubkey.encryptU64(units >> LO_BITS).toBytes())
}

describe('decryptAsAuditor', () => {
  it('recovers the amount of a real devnet Transfer with the auditor key', () => {
    expect(decryptAsAuditor(auditorKey, transfer.wire)).toEqual({ ok: true, units: UNITS })
  })

  it('accepts the key file pasted as is, pretty-printed and with a trailing newline', () => {
    const pasted = `${JSON.stringify(auditorBytes, null, 2)}\n`
    expect(decryptAsAuditor(pasted, transfer.wire)).toEqual({ ok: true, units: UNITS })
  })

  it('recovers an amount beyond 2³² units', () => {
    const units = (1n << 40n) + 5n
    expect(decryptAsAuditor(auditorKey, withAuditorAmount(units))).toEqual({ ok: true, units })
  })

  it('finds the Transfer inside a live Transfer + pledge transaction of another mint', () => {
    expect(decryptAsAuditor(auditorKey, livePledge.wire)).toEqual({
      ok: false,
      reason: 'wrong-key',
    })
  })

  it.each([
    ['the supporter key', keyText(transfer.context.keys.supporterElgamalSecret)],
    ['a fresh key', JSON.stringify([...new ElGamalKeypair().secret().toBytes()])],
  ])('refuses with %s instead of returning a number', (_, key) => {
    expect(decryptAsAuditor(key, transfer.wire)).toEqual({ ok: false, reason: 'wrong-key' })
  })

  it.each([
    ['empty', ''],
    ['not JSON', 'auditor'],
    ['hex instead of bytes', JSON.stringify(transfer.context.keys.auditorElgamalSecret)],
    ['31 bytes', JSON.stringify(auditorBytes.slice(1))],
    ['a byte above 255', JSON.stringify([256, ...auditorBytes.slice(1)])],
    ['a non-canonical scalar', JSON.stringify(Array(32).fill(255))],
    ['the zero scalar', JSON.stringify(Array(32).fill(0))],
  ])('rejects a key that is %s', (_, key) => {
    expect(decryptAsAuditor(key, transfer.wire)).toEqual({ ok: false, reason: 'invalid-key' })
  })

  it.each([
    ['a proof transaction', proofTx.wire],
    ['another confidential Token-2022 instruction', applyTx.wire],
  ])('refuses %s as not a Transfer', (_, wire) => {
    expect(decryptAsAuditor(auditorKey, wire)).toEqual({ ok: false, reason: 'not-a-transfer' })
  })

  it('refuses an auditor ciphertext that is not on the curve', () => {
    const { lo } = auditorCiphertexts(transfer.wire)
    const broken = replaceOnce(transfer.wire, lo, new Uint8Array(64).fill(0xff))
    expect(decryptAsAuditor(auditorKey, broken)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses bytes that are not a transaction', () => {
    expect(decryptAsAuditor(auditorKey, 'AAAA')).toEqual({ ok: false, reason: 'malformed' })
  })
})
