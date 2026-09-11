import { describe, expect, it } from 'vitest'
import { formatDay, formatUnits, formatUtc } from './format.ts'

describe('formatUnits', () => {
  it('renders base units as a decimal with two places', () => {
    expect(formatUnits('5000000', 6)).toBe('5.00')
    expect(formatUnits('8500000', 6)).toBe('8.50')
    expect(formatUnits('0', 6)).toBe('0.00')
  })

  it('keeps every digit of a u64 and a fractional tail beyond two places', () => {
    expect(formatUnits('18446744073709551615', 6)).toBe('18446744073709.551615')
    expect(formatUnits('1234567', 6)).toBe('1.234567')
    expect(formatUnits('1', 6)).toBe('0.000001')
  })

  it('takes decimals = 0 literally', () => {
    expect(formatUnits('42', 0)).toBe('42')
  })
})

describe('dates', () => {
  it('formatDay is the UTC calendar day of an ISO instant', () => {
    expect(formatDay('2026-09-14T23:59:59.000Z')).toBe('2026-09-14')
  })

  it('formatUtc is minute precision, marked UTC', () => {
    expect(formatUtc(new Date('2026-09-15T10:07:59Z'))).toBe('2026-09-15 10:07 UTC')
  })
})
