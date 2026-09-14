import { readFileSync } from 'node:fs'
import {
  AccountRole,
  address,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  none,
  some,
} from '@solana/kit'
import {
  AeKey,
  ElGamalKeypair,
  ElGamalSecretKey,
  GroupedElGamalCiphertext3Handles,
} from '@solana/zk-sdk'
import {
  AccountState,
  type Extension,
  parseApplyConfidentialPendingBalanceInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Token,
} from '@solana-program/token-2022'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  decryptAvailable,
  decryptContribution,
  decryptPending,
  elgamalFromSecret,
  extractValidityContext,
  HANDLE,
  type ValidityContext,
} from './decrypt.ts'

const FIXTURE_DIR = new URL('../../../../fixtures/tx/', import.meta.url)
const hex = z.string().regex(/^[0-9a-f]+$/)
const fixtureSchema = z.object({
  wire: z.string(),
  context: z.object({
    amount: z.string().regex(/^\d+$/),
    keys: z.object({
      supporterElgamalSecret: hex,
      creatorElgamalSecret: hex,
      creatorAe: hex,
      auditorElgamalSecret: hex,
    }),
  }),
})
const fixture = (name: string) =>
  fixtureSchema.parse(JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_DIR), 'utf8')))
const fromHex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'))
const keypair = (secretHex: string) =>
  ElGamalKeypair.fromSecretKey(ElGamalSecretKey.fromBytes(fromHex(secretHex)))

const proof2 = fixture('proof-2')
const AMOUNT = BigInt(proof2.context.amount)
const creator = keypair(proof2.context.keys.creatorElgamalSecret)
const supporter = keypair(proof2.context.keys.supporterElgamalSecret)
const auditor = keypair(proof2.context.keys.auditorElgamalSecret)

const GROUPED_BYTES = 128
const LO_BITS = 16n

function encrypt(amount: bigint): ValidityContext {
  const part = (v: bigint) =>
    GroupedElGamalCiphertext3Handles.encrypt(
      supporter.pubkey(),
      creator.pubkey(),
      auditor.pubkey(),
      v,
    ).toBytes()
  return { groupedLo: part(amount & 0xffffn), groupedHi: part(amount >> LO_BITS) }
}

function validityContext(): ValidityContext {
  const context = extractValidityContext(proof2.wire)
  if (!context) throw new Error('proof-2 fixture has no validity context')
  return context
}

describe('extractValidityContext', () => {
  it('reads both grouped ciphertexts from the real proof-2 transaction', () => {
    const context = validityContext()
    expect(context.groupedLo).toHaveLength(GROUPED_BYTES)
    expect(context.groupedHi).toHaveLength(GROUPED_BYTES)
    expect(() => GroupedElGamalCiphertext3Handles.fromBytes(context.groupedLo)).not.toThrow()
    expect(() => GroupedElGamalCiphertext3Handles.fromBytes(context.groupedHi)).not.toThrow()
  })

  it('returns null for transactions without the validity instruction', () => {
    expect(extractValidityContext(fixture('proof-1').wire)).toBeNull()
    expect(extractValidityContext(fixture('transfer').wire)).toBeNull()
    expect(extractValidityContext(fixture('close').wire)).toBeNull()
  })

  it('throws when the validity instruction carries no inline proof data', () => {
    const bytes = getBase64Encoder().encode(proof2.wire)
    const tx = getTransactionDecoder().decode(bytes)
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
    const verify =
      'instructions' in message ? message.instructions.find((ix) => ix.data?.[0] === 12) : undefined
    if (!verify?.data) throw new Error('proof-2 fixture has no validity instruction')
    // Той самий дискримінатор, але дані — лише u32 offset (варіант через Record).
    const tampered = Buffer.from(bytes)
    const dataOffset = tampered.indexOf(Buffer.from(verify.data))
    expect(dataOffset).toBeGreaterThan(0)
    // Байт довжини compact-u16 стоїть перед даними інструкції: 545 = [0xa1, 0x04].
    expect(tampered[dataOffset - 2]).toBe(0xa1)
    expect(tampered[dataOffset - 1]).toBe(0x04)
    const truncated = Buffer.concat([
      tampered.subarray(0, dataOffset - 2),
      Buffer.from([5]),
      tampered.subarray(dataOffset, dataOffset + 5),
    ])
    expect(() => extractValidityContext(truncated.toString('base64'))).toThrow(/proof data/)
  })
})

describe('decryptContribution', () => {
  const context = validityContext()

  it('recovers the known amount with the creator key on the destination handle', () => {
    expect(decryptContribution(creator, context)).toEqual({ ok: true, units: AMOUNT })
  })

  it('recovers the same amount for the auditor and the supporter on their handles', () => {
    expect(decryptContribution(auditor, context, HANDLE.auditor)).toEqual({
      ok: true,
      units: AMOUNT,
    })
    expect(decryptContribution(supporter, context, HANDLE.source)).toEqual({
      ok: true,
      units: AMOUNT,
    })
  })

  it('decrypts with a keypair rebuilt from the secret bytes, as the worker does', () => {
    const rebuilt = elgamalFromSecret(creator.secret().toBytes())
    expect(decryptContribution(rebuilt, validityContext())).toEqual({ ok: true, units: AMOUNT })
    expect(() => elgamalFromSecret(new Uint8Array(5))).toThrow()
  })

  it('reports wrong-key for a key that is not on the handle', () => {
    expect(decryptContribution(supporter, context)).toEqual({ ok: false, reason: 'wrong-key' })
    expect(decryptContribution(new ElGamalKeypair(), context)).toEqual({
      ok: false,
      reason: 'wrong-key',
    })
  })

  it('handles the edges of the single-logarithm range', () => {
    expect(decryptContribution(creator, encrypt(0n))).toEqual({ ok: true, units: 0n })
    const max = (1n << 32n) - 1n
    expect(decryptContribution(creator, encrypt(max))).toEqual({ ok: true, units: max })
  })

  it('falls back to two logarithms above 2^32', () => {
    const big = (1n << 32n) + 123_456n
    expect(decryptContribution(creator, encrypt(big))).toEqual({ ok: true, units: big })
    const max = (1n << 48n) - 1n
    expect(decryptContribution(creator, encrypt(max))).toEqual({ ok: true, units: max })
  })

  it('reports malformed for ciphertexts that do not parse', () => {
    expect(
      decryptContribution(creator, { ...context, groupedHi: context.groupedHi.slice(1) }),
    ).toEqual({ ok: false, reason: 'malformed' })
    const notAPoint = new Uint8Array(GROUPED_BYTES).fill(0xff)
    expect(decryptContribution(creator, { groupedLo: notAPoint, groupedHi: notAPoint })).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })
})

describe('decryptAvailable', () => {
  const MINT = address('6f1QTLNPh59wM26CQx1pnJTUcE814H64JaABjARPvtiC')
  const OWNER = address('AJ6LFWEJgLEwkfyWWipZ8Le5fV9QjCV61UCnzv9g5ZUq')
  const creatorAe = AeKey.fromBytes(fromHex(proof2.context.keys.creatorAe))

  function token(extension?: Extension): Token {
    return {
      mint: MINT,
      owner: OWNER,
      amount: 0n,
      delegate: none(),
      state: AccountState.Initialized,
      isNative: none(),
      delegatedAmount: 0n,
      closeAuthority: none(),
      extensions: extension ? some([extension]) : none(),
    }
  }

  function configured(decryptable: Uint8Array): Token {
    return token({
      __kind: 'ConfidentialTransferAccount',
      approved: true,
      elgamalPubkey: OWNER,
      pendingBalanceLow: new Uint8Array(64),
      pendingBalanceHigh: new Uint8Array(64),
      availableBalance: new Uint8Array(64),
      decryptableAvailableBalance: decryptable,
      allowConfidentialCredits: true,
      allowNonConfidentialCredits: true,
      pendingBalanceCreditCounter: 1n,
      maximumPendingBalanceCreditCounter: 65_536n,
      expectedPendingBalanceCreditCounter: 0n,
      actualPendingBalanceCreditCounter: 0n,
    })
  }

  // Після переказу автор зробив ApplyPendingBalance: новий decryptable-баланс у тій
  // транзакції — реальний AES-шифротекст суми під ключем автора.
  function decryptableFromApplyCreator(): Uint8Array {
    const { wire } = fixture('apply-creator')
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
    if (!('instructions' in message)) throw new Error('apply-creator fixture has no instructions')
    const keys = message.staticAccounts
    const apply = message.instructions.find(
      (ix) => keys[ix.programAddressIndex] === TOKEN_2022_PROGRAM_ADDRESS,
    )
    if (!apply?.data) throw new Error('apply-creator fixture has no Token-2022 instruction')
    const parsed = parseApplyConfidentialPendingBalanceInstruction({
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
      accounts: (apply.accountIndices ?? []).map((i) => ({
        address: keys[i] ?? OWNER,
        role: AccountRole.READONLY,
      })),
      data: apply.data,
    })
    return new Uint8Array(parsed.data.newDecryptableAvailableBalance)
  }

  it('decrypts the real post-transfer balance of the creator instantly', () => {
    const account = configured(decryptableFromApplyCreator())
    const started = performance.now()
    expect(decryptAvailable(creatorAe, account)).toEqual({ ok: true, units: AMOUNT })
    expect(performance.now() - started).toBeLessThan(50)
  })

  it('round-trips zero and u64 max', () => {
    expect(decryptAvailable(creatorAe, configured(creatorAe.encrypt(0n).toBytes()))).toEqual({
      ok: true,
      units: 0n,
    })
    const max = (1n << 64n) - 1n
    expect(decryptAvailable(creatorAe, configured(creatorAe.encrypt(max).toBytes()))).toEqual({
      ok: true,
      units: max,
    })
  })

  it('reports wrong-key for a foreign AES key', () => {
    const account = configured(decryptableFromApplyCreator())
    expect(decryptAvailable(new AeKey(), account)).toEqual({ ok: false, reason: 'wrong-key' })
  })

  it('reports unconfigured when the account has no confidential extension', () => {
    expect(decryptAvailable(creatorAe, token())).toEqual({ ok: false, reason: 'unconfigured' })
    expect(decryptAvailable(creatorAe, token({ __kind: 'ImmutableOwner' }))).toEqual({
      ok: false,
      reason: 'unconfigured',
    })
  })

  it('reports malformed when the decryptable balance does not parse', () => {
    expect(decryptAvailable(creatorAe, configured(new Uint8Array(3)))).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })
})

describe('decryptPending', () => {
  const MINT = address('6f1QTLNPh59wM26CQx1pnJTUcE814H64JaABjARPvtiC')
  const OWNER = address('AJ6LFWEJgLEwkfyWWipZ8Le5fV9QjCV61UCnzv9g5ZUq')

  function withPending(lo: Uint8Array, hi: Uint8Array, extension = true): Token {
    return {
      mint: MINT,
      owner: OWNER,
      amount: 0n,
      delegate: none(),
      state: AccountState.Initialized,
      isNative: none(),
      delegatedAmount: 0n,
      closeAuthority: none(),
      extensions: extension
        ? some([
            {
              __kind: 'ConfidentialTransferAccount',
              approved: true,
              elgamalPubkey: OWNER,
              pendingBalanceLow: lo,
              pendingBalanceHigh: hi,
              availableBalance: new Uint8Array(64),
              decryptableAvailableBalance: new Uint8Array(36),
              allowConfidentialCredits: true,
              allowNonConfidentialCredits: true,
              pendingBalanceCreditCounter: 1n,
              maximumPendingBalanceCreditCounter: 65_536n,
              expectedPendingBalanceCreditCounter: 0n,
              actualPendingBalanceCreditCounter: 0n,
            },
          ])
        : none(),
    }
  }
  const pending = (lo: bigint, hi: bigint) =>
    withPending(
      creator.pubkey().encryptU64(lo).toBytes(),
      creator.pubkey().encryptU64(hi).toBytes(),
    )

  it('adds the low 16 bits to the high part shifted, as the token program does', () => {
    expect(decryptPending(creator, pending(0xffffn, 3n))).toEqual({
      ok: true,
      units: 0xffffn + (3n << 16n),
    })
    expect(decryptPending(creator, pending(0n, 0n))).toEqual({ ok: true, units: 0n })
  })

  it('reports wrong-key for a foreign ElGamal key', () => {
    expect(decryptPending(supporter, pending(5n, 0n))).toEqual({ ok: false, reason: 'wrong-key' })
  })

  it('reports unconfigured without the extension and malformed for bytes that do not parse', () => {
    expect(
      decryptPending(creator, withPending(new Uint8Array(64), new Uint8Array(64), false)),
    ).toEqual({
      ok: false,
      reason: 'unconfigured',
    })
    expect(decryptPending(creator, withPending(new Uint8Array(3), new Uint8Array(64)))).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })
})
