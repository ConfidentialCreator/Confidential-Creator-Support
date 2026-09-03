import { apiErrorBodySchema } from '@ccsupport/shared'
import { address } from '@solana/kit'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { type AppDeps, createApp } from './app.ts'

const ORIGIN = 'http://localhost:5173'
const PAYER = address('AJ6LFWEJgLEwkfyWWipZ8Le5fV9QjCV61UCnzv9g5ZUq')

function build(overrides: Partial<AppDeps> = {}) {
  return createApp({
    logger: pino({ level: 'silent' }),
    webOrigin: ORIGIN,
    health: { payer: PAYER, slot: async () => 123n, payerLamports: async () => 500_000_000n },
    relay: {
      payer: { address: PAYER, submit: () => Promise.reject(new Error('not in this test')) },
    },
    ...overrides,
  })
}

describe('GET /health', () => {
  it('answers ok with the slot and the payer balance', async () => {
    const res = await build().request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: { ok: true, slot: 123, payer: PAYER, payerLamports: 500_000_000 },
    })
    expect(res.headers.get('x-request-id')).toMatch(/[0-9a-f-]{36}/)
  })

  it('answers 503 when the rpc fails or hangs', async () => {
    const failing = build({
      health: {
        payer: PAYER,
        slot: async () => {
          throw new Error('ECONNREFUSED')
        },
        payerLamports: async () => 0n,
      },
    })
    const res = await failing.request('/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      data: { ok: false, slot: null, payer: PAYER, payerLamports: null },
    })

    const hanging = build({
      health: {
        payer: PAYER,
        slot: () => new Promise(() => {}),
        payerLamports: async () => 0n,
        timeoutMs: 10,
      },
    })
    expect((await hanging.request('/health')).status).toBe(503)
  })
})

describe('cors', () => {
  it('allows only WEB_ORIGIN', async () => {
    const ours = await build().request('/health', { headers: { origin: ORIGIN } })
    expect(ours.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    const theirs = await build().request('/health', { headers: { origin: 'https://evil.example' } })
    expect(theirs.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('rate limit', () => {
  it('throttles /relay/* but not /health', async () => {
    const app = build({ rateLimit: { limit: 1, now: () => 0 } })
    expect((await app.request('/relay/proofs', { method: 'POST' })).status).toBe(400)
    const limited = await app.request('/relay/proofs', { method: 'POST' })
    expect(limited.status).toBe(429)
    expect(apiErrorBodySchema.parse(await limited.json()).error.code).toBe('RATE_LIMITED')
    expect((await app.request('/health')).status).toBe(200)
    expect((await app.request('/health')).status).toBe(200)
  })
})

describe('errors', () => {
  it('answers an unknown path in the shared error format', async () => {
    const res = await build().request('/nope')
    expect(res.status).toBe(404)
    expect(apiErrorBodySchema.parse(await res.json()).error.code).toBe('NOT_FOUND')
  })
})
