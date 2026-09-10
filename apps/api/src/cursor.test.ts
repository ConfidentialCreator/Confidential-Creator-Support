import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { decodeCursor, encodeCursor } from './cursor.ts'

const pair = z.tuple([z.string(), z.string()])

describe('cursor', () => {
  it('round-trips a tuple through a url-safe string', () => {
    const cursor = encodeCursor(['2026-09-01T00:00:00.000Z', 'D4Tk'])
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(cursor, pair)).toEqual(['2026-09-01T00:00:00.000Z', 'D4Tk'])
  })

  it('returns null for garbage, wrong shape and wrong arity', () => {
    expect(decodeCursor('not base64 at all!', pair)).toBeNull()
    expect(decodeCursor(Buffer.from('{"a":1}').toString('base64url'), pair)).toBeNull()
    expect(decodeCursor(encodeCursor(['one']), pair)).toBeNull()
    expect(decodeCursor(encodeCursor(['a', 'b', 'c']), pair)).toBeNull()
  })
})
