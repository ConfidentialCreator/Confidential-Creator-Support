import { describe, expect, it } from 'vitest'
import { fetchHealth } from './health.ts'

const respond = (status: number, body: unknown): typeof fetch => {
  return async () => new Response(JSON.stringify(body), { status })
}

describe('fetchHealth', () => {
  it('returns the slot when the api is up', async () => {
    const health = await fetchHealth(
      'http://api',
      respond(200, { data: { ok: true, slot: 371852406, payerLamports: 5000 } }),
    )
    expect(health).toEqual({ ok: true, slot: 371852406, payerLamports: 5000 })
  })

  it('returns ok: false when the api answers 503 with nulls', async () => {
    const health = await fetchHealth(
      'http://api',
      respond(503, { data: { ok: false, slot: null, payerLamports: null } }),
    )
    expect(health).toEqual({ ok: false, slot: null, payerLamports: null })
  })

  it('throws on a body that is not the health envelope', async () => {
    await expect(fetchHealth('http://api', respond(200, { hello: 1 }))).rejects.toThrow()
  })

  it('hits GET <apiUrl>/health', async () => {
    let seen: string | undefined
    const spy: typeof fetch = async (input) => {
      seen = String(input)
      return new Response(JSON.stringify({ data: { ok: true, slot: 1, payerLamports: 0 } }))
    }
    await fetchHealth('http://api', spy)
    expect(seen).toBe('http://api/health')
  })
})
