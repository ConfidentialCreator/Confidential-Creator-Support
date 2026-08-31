import type { Address } from '@ccsupport/shared'
import type { MessageModifyingSigner } from '@solana/kit'
import { describe, expect, it, vi } from 'vitest'
import { createKeySession, type DeriveKeys } from './session.ts'

const OWNER = 'SupZRdr1Demo4kQ9pW2mR7sXb5nLc8dFg3hJt6yUvQ' as Address
const OTHER = 'Ccs1MarrowDemo4kQ9pW2mR7sXb5nLc8dFg3hJt6yUvE' as Address
const MINT = 'So11111111111111111111111111111111111111112' as Address
const MINT_2 = 'So11111111111111111111111111111111111111113' as Address

const signer = {} as MessageModifyingSigner
const keys = (tag: string) => ({ tag }) as unknown as Awaited<ReturnType<DeriveKeys>>

describe('createKeySession', () => {
  it('derives once per owner and mint, then serves the same keys', async () => {
    const derive = vi.fn(async (_s: MessageModifyingSigner, owner: Address, mint: Address) =>
      keys(`${owner}:${mint}`),
    )
    const session = createKeySession(derive)
    const first = await session.get(signer, OWNER, MINT)
    const second = await session.get(signer, OWNER, MINT)
    expect(second).toBe(first)
    expect(derive).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight derivation between concurrent callers', async () => {
    const derive = vi.fn(async () => keys('k'))
    const session = createKeySession(derive)
    const [a, b] = await Promise.all([
      session.get(signer, OWNER, MINT),
      session.get(signer, OWNER, MINT),
    ])
    expect(a).toBe(b)
    expect(derive).toHaveBeenCalledTimes(1)
  })

  it('keeps a different mint or owner apart', async () => {
    const derive = vi.fn(async (_s: MessageModifyingSigner, owner: Address, mint: Address) =>
      keys(`${owner}:${mint}`),
    )
    const session = createKeySession(derive)
    await session.get(signer, OWNER, MINT)
    await session.get(signer, OWNER, MINT_2)
    await session.get(signer, OTHER, MINT)
    expect(derive).toHaveBeenCalledTimes(3)
  })

  it('does not cache a failed derivation', async () => {
    const derive = vi
      .fn<DeriveKeys>()
      .mockRejectedValueOnce(new Error('user rejected'))
      .mockResolvedValueOnce(keys('k'))
    const session = createKeySession(derive)
    await expect(session.get(signer, OWNER, MINT)).rejects.toThrow('user rejected')
    await expect(session.get(signer, OWNER, MINT)).resolves.toEqual(keys('k'))
    expect(derive).toHaveBeenCalledTimes(2)
  })

  it('forget drops everything so the next call derives again', async () => {
    const derive = vi.fn(async () => keys('k'))
    const session = createKeySession(derive)
    await session.get(signer, OWNER, MINT)
    session.forget()
    await session.get(signer, OWNER, MINT)
    expect(derive).toHaveBeenCalledTimes(2)
  })
})
