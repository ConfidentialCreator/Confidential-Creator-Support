import { describe, expect, it } from 'vitest'
import { AUDIT_KEY } from '../../mockData.ts'
import { keyFits } from './key.ts'

describe('keyFits', () => {
  it('accepts the audit key, with surrounding whitespace', () => {
    expect(keyFits(AUDIT_KEY)).toBe(true)
    expect(keyFits(`  ${AUDIT_KEY}\n`)).toBe(true)
  })

  it('refuses a key off by one character', () => {
    expect(keyFits(`${AUDIT_KEY.slice(0, -1)}4`)).toBe(false)
  })

  it('refuses an empty key', () => {
    expect(keyFits('')).toBe(false)
  })
})
