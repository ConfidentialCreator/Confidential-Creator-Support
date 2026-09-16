import {
  type Address,
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  createSignableMessage,
  type MessageModifyingSigner,
  type MessagePartialSigner,
  type SignableMessage,
  type SignatureBytes,
  type SignatureDictionary,
} from '@solana/kit'
import type { ConfidentialKeys } from '@solana/zk-sdk'
import { describe, expect, it } from 'vitest'
import { deriveConfidentialKeys } from './keys.ts'

const MINT = address('6f1QTLNPh59wM26CQx1pnJTUcE814H64JaABjARPvtiC')
const OTHER_MINT = address('HApEuJSUaLofM9Z7PUhAKfxpHkapxBTmpdsnjG9nud36')

const fixedSigner = (seed: number) =>
  createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(seed))

const fingerprint = (keys: ConfidentialKeys) => ({
  elgamal: Array.from(keys.elgamal().pubkey().toBytes()),
  ae: Array.from(keys.ae().toBytes()),
})

// A wallet that signs exactly what it is given — like Phantom/Solflare/Backpack.
const asModifying = (inner: MessagePartialSigner): MessageModifyingSigner => ({
  address: inner.address,
  async modifyAndSignMessages(messages) {
    const dictionaries = await inner.signMessages(messages)
    return messages.map((m, i) => ({ ...m, signatures: dictionaries[i] ?? {} }))
  },
})

describe('deriveConfidentialKeys', () => {
  it('is deterministic for the same signer and mint', async () => {
    const signer = await fixedSigner(7)
    const a = await deriveConfidentialKeys(signer, signer.address, MINT)
    const b = await deriveConfidentialKeys(signer, signer.address, MINT)
    expect(fingerprint(a)).toEqual(fingerprint(b))
  })

  it('signs the canonical solana-conf-bal/v1 message over owner‖mint', async () => {
    const signer = await fixedSigner(7)
    const seen: Uint8Array[] = []
    const spy: MessagePartialSigner = {
      address: signer.address,
      signMessages(messages) {
        for (const m of messages) seen.push(m.content)
        return signer.signMessages(messages)
      },
    }
    await deriveConfidentialKeys(spy, signer.address, MINT)

    expect(seen).toHaveLength(1)
    const message = seen[0] ?? new Uint8Array()
    expect(new TextDecoder().decode(message.slice(0, 18))).toBe('solana-conf-bal/v1')
    expect(message).toHaveLength(18 + 64)
  })

  it('gives different keys for a different mint and for a different owner', async () => {
    const signer = await fixedSigner(7)
    const other = await fixedSigner(8)
    const base = fingerprint(await deriveConfidentialKeys(signer, signer.address, MINT))
    expect(
      fingerprint(await deriveConfidentialKeys(signer, signer.address, OTHER_MINT)),
    ).not.toEqual(base)
    expect(fingerprint(await deriveConfidentialKeys(other, other.address, MINT))).not.toEqual(base)
  })

  it('accepts a wallet-style modifying signer that leaves the message intact', async () => {
    const signer = await fixedSigner(7)
    const direct = fingerprint(await deriveConfidentialKeys(signer, signer.address, MINT))
    const viaWallet = fingerprint(
      await deriveConfidentialKeys(asModifying(signer), signer.address, MINT),
    )
    expect(viaWallet).toEqual(direct)
  })

  it('refuses a wallet that alters the message before signing', async () => {
    const signer = await fixedSigner(7)
    const prefixing: MessageModifyingSigner = {
      address: signer.address,
      async modifyAndSignMessages(messages) {
        const altered = messages.map((m) =>
          createSignableMessage(
            new Uint8Array([...new TextEncoder().encode('nonce:'), ...m.content]),
          ),
        )
        const dictionaries = await signer.signMessages(altered)
        return altered.map((m, i) => ({ ...m, signatures: dictionaries[i] ?? {} }))
      },
    }
    await expect(deriveConfidentialKeys(prefixing, signer.address, MINT)).rejects.toThrow(/altered/)
  })

  it('refuses an all-zero signature instead of deriving predictable keys', async () => {
    const signer = await fixedSigner(7)
    const zero: MessagePartialSigner = {
      address: signer.address,
      signMessages: async (messages: readonly SignableMessage[]) =>
        messages.map(
          (): SignatureDictionary => ({ [signer.address]: new Uint8Array(64) as SignatureBytes }),
        ),
    }
    await expect(deriveConfidentialKeys(zero, signer.address, MINT)).rejects.toThrow()
  })

  it('refuses to derive for an owner the signer does not control', async () => {
    const signer = await fixedSigner(7)
    const other: Address = (await fixedSigner(8)).address
    await expect(deriveConfidentialKeys(signer, other, MINT)).rejects.toThrow(/owner/)
  })
})
