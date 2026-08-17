import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { HANDLE_PATTERN, handleSchema } from './handle.ts'

const fixture = z
  .object({ pattern: z.string(), valid: z.array(z.string()), invalid: z.array(z.string()) })
  .parse(
    JSON.parse(readFileSync(new URL('../../../fixtures/handle.json', import.meta.url), 'utf8')),
  )

describe('handle', () => {
  it('shares one pattern with the program through the fixture', () => {
    expect(HANDLE_PATTERN.source).toBe(fixture.pattern)
  })

  it.each(fixture.valid)('accepts %j', (handle) => {
    expect(handleSchema.parse(handle)).toBe(handle)
  })

  it.each(fixture.invalid)('rejects %j', (handle) => {
    expect(handleSchema.safeParse(handle).success).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(handleSchema.safeParse(42).success).toBe(false)
    expect(handleSchema.safeParse(undefined).success).toBe(false)
  })
})
