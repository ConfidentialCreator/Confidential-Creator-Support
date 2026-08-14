import { describe, expect, it } from 'vitest'
import { confirmations, isInsufficient, parseAmount, steps } from './flow.ts'

describe('parseAmount', () => {
  it('reads a positive decimal', () => {
    expect(parseAmount('8.00')).toBe(8)
    expect(parseAmount('24.5')).toBe(24.5)
  })

  it('refuses zero, negatives and text', () => {
    expect(parseAmount('0')).toBeNull()
    expect(parseAmount('-3')).toBeNull()
    expect(parseAmount('eight')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
})

describe('isInsufficient', () => {
  it('is false at the balance and true above it', () => {
    expect(isInsufficient('24.50', 24.5)).toBe(false)
    expect(isInsufficient('24.51', 24.5)).toBe(true)
  })

  it('is false for unparsable input — nothing to refuse yet', () => {
    expect(isInsufficient('', 24.5)).toBe(false)
  })
})

describe('steps', () => {
  it('first support asks for five confirmations and shows the amount in step 3', () => {
    const list = steps('first', '12.00')
    expect(list).toHaveLength(5)
    expect(list[2]).toBe('Move 12.00 SUPD into your sealed balance')
    expect(confirmations('first')).toBe(
      '5 confirmations · about 3 minutes · the platform pays for the proofs, you pay only for what you sign',
    )
  })

  it('returning supporter asks for two', () => {
    const list = steps('returning', '12.00')
    expect(list).toEqual([
      'Sign a message to derive your keys · no fee',
      'Transfer and record support — one transaction',
    ])
    expect(confirmations('returning')).toBe('2 confirmations · under a minute')
  })

  it('echoes raw input in step 3 while it does not parse', () => {
    expect(steps('first', '')[2]).toBe('Move  SUPD into your sealed balance')
  })
})
