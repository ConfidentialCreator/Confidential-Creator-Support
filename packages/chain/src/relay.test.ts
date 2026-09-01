import { ApiError } from '@ccsupport/shared'
import { address, type Base64EncodedWireTransaction } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { fetchRelayPayer, relayClose, relayProofs } from './relay.ts'

const BASE = 'http://api.test'
const TX = 'AQID' as Base64EncodedWireTransaction
const SIG =
  '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW'

type Call = { url: string; init: RequestInit | undefined }

function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return async (input, init) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
}

describe('relayProofs / relayClose', () => {
  it('posts the transactions and returns the signatures', async () => {
    const calls: Call[] = []
    const fetchImpl = fakeFetch(200, { data: { signatures: [SIG] } }, calls)

    const signatures = await relayProofs(BASE, [TX], fetchImpl)

    expect(signatures).toEqual([SIG])
    expect(calls[0]?.url).toBe(`${BASE}/relay/proofs`)
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ transactions: [TX] })
  })

  it('targets /relay/close for the cleanup stage', async () => {
    const calls: Call[] = []
    await relayClose(BASE, [TX], fakeFetch(200, { data: { signatures: [SIG] } }, calls))
    expect(calls[0]?.url).toBe(`${BASE}/relay/close`)
  })

  it('surfaces the relay refusal as ApiError with its reason', async () => {
    const fetchImpl = fakeFetch(400, {
      error: { code: 'INVALID_INPUT', message: 'refused', details: { reason: 'fee payer' } },
    })
    const failure = relayProofs(BASE, [TX], fetchImpl)
    await expect(failure).rejects.toBeInstanceOf(ApiError)
    await expect(failure).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      details: { reason: 'fee payer' },
    })
  })

  it('rejects a response that is neither data nor error', async () => {
    await expect(relayProofs(BASE, [TX], fakeFetch(200, { ok: true }))).rejects.toThrow()
  })

  it('refuses to send an empty or oversized batch without a request', async () => {
    const calls: Call[] = []
    const fetchImpl = fakeFetch(200, { data: { signatures: [SIG] } }, calls)
    await expect(relayProofs(BASE, [], fetchImpl)).rejects.toThrow()
    await expect(relayProofs(BASE, [TX, TX, TX, TX, TX], fetchImpl)).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})

describe('fetchRelayPayer', () => {
  const PAYER = address('AJ6LFWEJgLEwkfyWWipZ8Le5fV9QjCV61UCnzv9g5ZUq')

  it('reads the payer address from /health', async () => {
    const calls: Call[] = []
    const fetchImpl = fakeFetch(200, { data: { ok: true, payer: PAYER } }, calls)
    expect(await fetchRelayPayer(BASE, fetchImpl)).toBe(PAYER)
    expect(calls[0]?.url).toBe(`${BASE}/health`)
  })

  it('rejects a health response without a valid address', async () => {
    await expect(fetchRelayPayer(BASE, fakeFetch(200, { data: { ok: true } }))).rejects.toThrow()
    await expect(
      fetchRelayPayer(BASE, fakeFetch(200, { data: { ok: true, payer: 'nope' } })),
    ).rejects.toThrow()
  })
})
