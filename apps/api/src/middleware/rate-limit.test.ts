import { apiErrorBodySchema } from '@ccsupport/shared'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.ts'
import { clientIp, rateLimit } from './rate-limit.ts'

function build(options: { limit: number; windowMs: number; now: () => number }) {
  const app = new Hono<AppEnv>()
  app.use('*', rateLimit(options))
  app.get('/x', (c) => c.text('ok'))
  return app
}

describe('rateLimit', () => {
  it('lets `limit` requests through and rejects the next with headers', async () => {
    const app = build({ limit: 2, windowMs: 1000, now: () => 5000 })
    const first = await app.request('/x')
    expect(first.status).toBe(200)
    expect(first.headers.get('RateLimit-Remaining')).toBe('1')
    expect((await app.request('/x')).status).toBe(200)
    const third = await app.request('/x')
    expect(third.status).toBe(429)
    expect(third.headers.get('RateLimit-Remaining')).toBe('0')
    expect(third.headers.get('Retry-After')).toBe('1')
    expect(apiErrorBodySchema.parse(await third.json()).error.code).toBe('RATE_LIMITED')
  })

  it('slides: a request older than the window frees a slot', async () => {
    let at = 0
    const app = build({ limit: 2, windowMs: 1000, now: () => at })
    await app.request('/x')
    at = 500
    await app.request('/x')
    at = 900
    expect((await app.request('/x')).status).toBe(429)
    at = 1001
    expect((await app.request('/x')).status).toBe(200)
    expect((await app.request('/x')).status).toBe(429)
  })

  it('keeps separate budgets per client ip', async () => {
    const app = build({ limit: 1, windowMs: 1000, now: () => 0 })
    const as = (ip: string) => app.request('/x', { headers: { 'x-forwarded-for': ip } })
    expect((await as('1.1.1.1')).status).toBe(200)
    expect((await as('2.2.2.2')).status).toBe(200)
    expect((await as('1.1.1.1')).status).toBe(429)
  })
})

describe('clientIp', () => {
  const ipOf = async (headers: Record<string, string>) => {
    const app = new Hono<AppEnv>().get('/x', (c) => c.text(clientIp(c)))
    const res = await app.request('/x', { headers })
    return res.text()
  }

  it('takes the last forwarded address — the one the trusted proxy wrote', async () => {
    expect(await ipOf({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1 , 3.3.3.3' })).toBe('3.3.3.3')
  })

  it('falls back to x-real-ip, then to unknown', async () => {
    expect(await ipOf({ 'x-real-ip': '4.4.4.4' })).toBe('4.4.4.4')
    expect(await ipOf({})).toBe('unknown')
  })
})
