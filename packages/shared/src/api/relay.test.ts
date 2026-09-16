import { describe, expect, it } from 'vitest'
import { relayRequestSchema, relaySignaturesSchema } from './relay.ts'

const tx = 'AQID' // any base64

describe('relayRequestSchema', () => {
  it('accepts one to four base64 transactions', () => {
    expect(relayRequestSchema.parse({ transactions: [tx] }).transactions).toEqual([tx])
    expect(relayRequestSchema.safeParse({ transactions: [tx, tx, tx, tx] }).success).toBe(true)
  })

  it('rejects an empty list and more than four', () => {
    expect(relayRequestSchema.safeParse({ transactions: [] }).success).toBe(false)
    expect(relayRequestSchema.safeParse({ transactions: [tx, tx, tx, tx, tx] }).success).toBe(false)
  })

  it('rejects strings that are not base64', () => {
    expect(relayRequestSchema.safeParse({ transactions: ['not base64!'] }).success).toBe(false)
  })
})

describe('relaySignaturesSchema', () => {
  it('requires a non-empty list of signatures', () => {
    expect(relaySignaturesSchema.safeParse({ signatures: [] }).success).toBe(false)
    expect(relaySignaturesSchema.safeParse({ signatures: ['5x'] }).success).toBe(true)
  })
})
