import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { API_ERROR_CODES, ApiError, apiErrorBodySchema, apiResponseSchema } from './api-error.ts'

describe('apiErrorBodySchema', () => {
  it('accepts every code from the rules with optional details', () => {
    for (const code of API_ERROR_CODES) {
      expect(apiErrorBodySchema.safeParse({ error: { code, message: 'x' } }).success).toBe(true)
    }
    const relayRefusal = {
      error: {
        code: 'INVALID_INPUT',
        message: 'refused',
        details: { reason: 'fee payer mismatch' },
      },
    }
    expect(apiErrorBodySchema.parse(relayRefusal).error.details?.reason).toBe('fee payer mismatch')
  })

  it('rejects codes outside the list and a missing message', () => {
    expect(
      apiErrorBodySchema.safeParse({ error: { code: 'RELAY_REFUSED', message: 'x' } }).success,
    ).toBe(false)
    expect(apiErrorBodySchema.safeParse({ error: { code: 'INTERNAL' } }).success).toBe(false)
  })
})

describe('apiResponseSchema', () => {
  const schema = apiResponseSchema(z.object({ slot: z.number() }))

  it('parses a data envelope with the given schema', () => {
    expect(schema.parse({ data: { slot: 7 } })).toEqual({ data: { slot: 7 } })
  })

  it('parses an error envelope', () => {
    const parsed = schema.parse({ error: { code: 'NOT_FOUND', message: 'no creator' } })
    expect('error' in parsed && parsed.error.code).toBe('NOT_FOUND')
  })

  it('rejects an envelope with neither side or with invalid data', () => {
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ data: { slot: 'seven' } }).success).toBe(false)
  })
})

describe('ApiError', () => {
  it('serialises to the error envelope', () => {
    const err = new ApiError('RATE_LIMITED', 'slow down')
    expect(err).toBeInstanceOf(Error)
    expect(apiErrorBodySchema.parse(err.toBody())).toEqual({
      error: { code: 'RATE_LIMITED', message: 'slow down' },
    })
  })

  it('keeps details.reason for relay refusals', () => {
    const err = new ApiError('INVALID_INPUT', 'refused', { reason: 'program not allowed' })
    expect(err.toBody()).toEqual({
      error: {
        code: 'INVALID_INPUT',
        message: 'refused',
        details: { reason: 'program not allowed' },
      },
    })
  })
})
