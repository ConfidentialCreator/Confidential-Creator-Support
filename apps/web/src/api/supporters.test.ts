import { describe, expect, it } from 'vitest'
import { fetchSupporterPledges } from './supporters.ts'

const SUPPORTER = 'D4TkDq52FCqPyvwgQWBDepBumsYKB5ZjroRLfGckrYnQ'

const row = {
  creator: '6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk',
  handle: 'marrow-dispatch',
  name: 'Ilse Marrow',
  expiresAt: '2026-10-14T12:57:26.000Z',
  active: true,
  daysLeft: 16,
  contributions: 2,
}

function respond(status: number, body: unknown) {
  const seen: string[] = []
  const impl: typeof fetch = async (input) => {
    seen.push(String(input))
    return new Response(JSON.stringify(body), { status })
  }
  return { impl, seen }
}

describe('fetchSupporterPledges', () => {
  it('returns the rows from GET <apiUrl>/supporters/<wallet>/pledges', async () => {
    const { impl, seen } = respond(200, { data: [row] })
    expect(await fetchSupporterPledges('http://api', SUPPORTER, impl)).toEqual([row])
    expect(seen).toEqual([`http://api/supporters/${SUPPORTER}/pledges`])
  })

  it('returns an empty list for a wallet that never pledged', async () => {
    const { impl } = respond(200, { data: [] })
    expect(await fetchSupporterPledges('http://api', SUPPORTER, impl)).toEqual([])
  })

  it('throws on an error envelope and on a malformed row', async () => {
    const invalid = respond(400, { error: { code: 'INVALID_INPUT', message: 'bad wallet' } })
    await expect(fetchSupporterPledges('http://api', SUPPORTER, invalid.impl)).rejects.toThrow(
      /bad wallet/,
    )
    const garbage = respond(200, { data: [{ ...row, daysLeft: -1 }] })
    await expect(fetchSupporterPledges('http://api', SUPPORTER, garbage.impl)).rejects.toThrow()
  })
})
