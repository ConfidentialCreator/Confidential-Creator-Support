import { ApiError } from '@ccsupport/shared'
import { address } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { requestFaucet } from './faucet.ts'

const WALLET = address('6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk')

function respond(status: number, body: unknown) {
  const seen: { url: string; init: RequestInit | undefined }[] = []
  const impl: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), init })
    return new Response(JSON.stringify(body), { status })
  }
  return { impl, seen }
}

describe('requestFaucet', () => {
  it('posts the wallet to /devnet/faucet and returns the portion', async () => {
    const { impl, seen } = respond(200, {
      data: { signature: 'sig', lamports: 20_000_000, units: 100_000_000 },
    })
    expect(await requestFaucet('http://api', WALLET, impl)).toEqual({
      signature: 'sig',
      lamports: 20_000_000,
      units: 100_000_000,
    })
    expect(seen[0]?.url).toBe('http://api/devnet/faucet')
    expect(seen[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ wallet: WALLET })
  })

  it('throws the api error with its code when the faucet refuses', async () => {
    const { impl } = respond(429, {
      error: { code: 'RATE_LIMITED', message: 'three portions per hour' },
    })
    await expect(requestFaucet('http://api', WALLET, impl)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'RATE_LIMITED',
    })
  })

  it('refuses a body that is not a faucet answer', async () => {
    const { impl } = respond(200, { data: { signature: 'sig' } })
    await expect(requestFaucet('http://api', WALLET, impl)).rejects.not.toBeInstanceOf(ApiError)
  })
})
