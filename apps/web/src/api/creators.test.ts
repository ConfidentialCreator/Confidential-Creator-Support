import { describe, expect, it } from 'vitest'
import { fetchAllContributions, fetchCreator, fetchSupporters } from './creators.ts'

const CREATOR = '6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk'
const SUPPORTER = 'D4TkDq52FCqPyvwgQWBDepBumsYKB5ZjroRLfGckrYnQ'

const profile = {
  wallet: CREATOR,
  handle: 'marrow-dispatch',
  name: 'Ilse Marrow',
  description: 'Independent reporting.',
  suggestedAmount: '5000000',
  createdSlot: 498814836,
  activeSupporters: 128,
  totalSupporters: 130,
}

const notFound = { error: { code: 'NOT_FOUND', message: 'no creator with this handle' } }

function respond(status: number, body: unknown) {
  const seen: string[] = []
  const impl: typeof fetch = async (input) => {
    seen.push(String(input))
    return new Response(JSON.stringify(body), { status })
  }
  return { impl, seen }
}

describe('fetchCreator', () => {
  it('returns the profile from GET <apiUrl>/creators/<handle>', async () => {
    const { impl, seen } = respond(200, { data: profile })
    expect(await fetchCreator('http://api', 'marrow-dispatch', impl)).toEqual(profile)
    expect(seen).toEqual(['http://api/creators/marrow-dispatch'])
  })

  it('returns null on NOT_FOUND: an unregistered handle is an answer, not a failure', async () => {
    const { impl } = respond(404, notFound)
    expect(await fetchCreator('http://api', 'nobody-here', impl)).toBeNull()
  })

  it('throws on any other error envelope and on a malformed body', async () => {
    const internal = respond(500, { error: { code: 'INTERNAL', message: 'internal error' } })
    await expect(fetchCreator('http://api', 'x-y-z', internal.impl)).rejects.toThrow(/internal/)
    const garbage = respond(200, { data: { ...profile, activeSupporters: 'many' } })
    await expect(fetchCreator('http://api', 'x-y-z', garbage.impl)).rejects.toThrow()
  })
})

describe('fetchSupporters', () => {
  const page = {
    count: 128,
    items: [
      {
        wallet: SUPPORTER,
        since: '2026-09-14T10:00:00.000Z',
        expiresAt: '2026-10-14T10:00:00.000Z',
      },
    ],
    nextCursor: 'abc',
  }

  it('returns the first page without a cursor and passes one through when given', async () => {
    const { impl, seen } = respond(200, { data: page })
    expect(await fetchSupporters('http://api', 'marrow-dispatch', undefined, impl)).toEqual(page)
    await fetchSupporters('http://api', 'marrow-dispatch', 'abc', impl)
    expect(seen).toEqual([
      'http://api/creators/marrow-dispatch/supporters',
      'http://api/creators/marrow-dispatch/supporters?cursor=abc',
    ])
  })

  it('throws on NOT_FOUND: the page asks for supporters only after the profile answered', async () => {
    const { impl } = respond(404, notFound)
    await expect(fetchSupporters('http://api', 'nobody-here', undefined, impl)).rejects.toThrow(
      /no creator/,
    )
  })
})

describe('fetchAllContributions', () => {
  const half = Buffer.alloc(128, 7).toString('base64')
  const item = (n: number) => ({
    sig: `sig-${n}`,
    supporter: SUPPORTER,
    slot: 498_000_000 + n,
    blockTime: '2026-09-14T10:00:00.000Z',
    periods: 1,
    groupedLo: half,
    groupedHi: half,
  })

  function pages(bodies: readonly unknown[]) {
    const seen: string[] = []
    const impl: typeof fetch = async (input) => {
      seen.push(String(input))
      return new Response(JSON.stringify(bodies[seen.length - 1]), { status: 200 })
    }
    return { impl, seen }
  }

  it('follows the cursor to the last page at the largest page size and joins the items', async () => {
    const { impl, seen } = pages([
      { data: { items: [item(2), item(1)], nextCursor: 'c1' } },
      { data: { items: [item(0)], nextCursor: null } },
    ])
    const items = await fetchAllContributions('http://api', 'marrow-dispatch', impl)
    expect(items.map((c) => c.sig)).toEqual(['sig-2', 'sig-1', 'sig-0'])
    expect(seen).toEqual([
      'http://api/creators/marrow-dispatch/contributions?limit=100',
      'http://api/creators/marrow-dispatch/contributions?limit=100&cursor=c1',
    ])
  })

  it('returns an empty list for a creator without contributions', async () => {
    const { impl } = pages([{ data: { items: [], nextCursor: null } }])
    expect(await fetchAllContributions('http://api', 'marrow-dispatch', impl)).toEqual([])
  })

  it('throws when a later page fails: a partial list would understate the period', async () => {
    const { impl } = pages([
      { data: { items: [item(1)], nextCursor: 'c1' } },
      { error: { code: 'INTERNAL', message: 'internal error' } },
    ])
    await expect(fetchAllContributions('http://api', 'marrow-dispatch', impl)).rejects.toThrow(
      /internal/,
    )
  })
})
