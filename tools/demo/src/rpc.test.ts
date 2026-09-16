import {
  type RpcTransport,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SolanaError,
} from '@solana/kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPacedTransport } from './rpc.ts'

const http = (statusCode: number, retryAfter?: string) =>
  new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
    headers: new Headers(retryAfter ? { 'retry-after': retryAfter } : {}),
    message: '',
    statusCode,
  })

function harness(responses: (unknown | Error)[]) {
  const calls: { at: number; method: string }[] = []
  const inner: RpcTransport = async <T>(config: Parameters<RpcTransport>[0]) => {
    calls.push({ at: Date.now(), method: (config.payload as { method: string }).method })
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  const transport = createPacedTransport(inner, { rps: 10, sendRps: 1, maxAttempts: 3 })
  const request = (id: number, method = 'getSlot') => transport({ payload: { id, method } })
  return { calls, request }
}

async function settle<T>(promise: Promise<T>, ms: number): Promise<T> {
  const guarded = promise.catch((err: unknown) => err)
  await vi.advanceTimersByTimeAsync(ms)
  const value = await guarded
  if (value instanceof Error) throw value
  return value as T
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createPacedTransport', () => {
  it('spaces concurrent requests by 1/rps', async () => {
    const { calls, request } = harness([1, 2, 3])
    const all = Promise.all([request(1), request(2), request(3)])
    await expect(settle(all, 1_000)).resolves.toEqual([1, 2, 3])
    expect(calls.map((c) => c.at)).toEqual([0, 100, 200])
  })

  it('keeps sendTransaction on its own slower lane', async () => {
    const { calls, request } = harness(['a', 'b', 'c', 'd'])
    const all = Promise.all([
      request(1, 'sendTransaction'),
      request(2, 'sendTransaction'),
      request(3),
      request(4),
    ])
    // responses arrive in execution order: 1, 3, 4, then 2 a second later
    await expect(settle(all, 2_000)).resolves.toEqual(['a', 'd', 'b', 'c'])
    expect(calls).toEqual([
      { at: 0, method: 'sendTransaction' },
      { at: 0, method: 'getSlot' },
      { at: 100, method: 'getSlot' },
      { at: 1_000, method: 'sendTransaction' },
    ])
  })

  it('retries a 429 after the backoff and honours retry-after', async () => {
    const { calls, request } = harness([http(429, '2'), http(429), 'ok'])
    await expect(settle(request(1), 10_000)).resolves.toBe('ok')
    expect(calls.map((c) => c.at)).toEqual([0, 2_000, 4_000])
  })

  it('gives up after maxAttempts', async () => {
    const { calls, request } = harness([http(429), http(429), http(429), 'never'])
    await expect(settle(request(1), 60_000)).rejects.toMatchObject({
      context: { statusCode: 429 },
    })
    expect(calls).toHaveLength(3)
  })

  it('does not retry other errors', async () => {
    const { calls, request } = harness([http(500), 'never'])
    await expect(settle(request(1), 60_000)).rejects.toMatchObject({
      context: { statusCode: 500 },
    })
    expect(calls).toHaveLength(1)
  })
})
