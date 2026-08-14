import { describe, expect, it } from 'vitest'
import { payments } from '../../mockData.ts'
import { filterPayments } from './filter.ts'

describe('filterPayments', () => {
  it('all keeps every row in order', () => {
    expect(filterPayments(payments, 'all')).toBe(payments)
  })

  it('listed keeps the four who asked to be listed', () => {
    const rows = filterPayments(payments, 'listed')
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.listed)).toBe(true)
  })

  it('hidden is the complement', () => {
    expect(filterPayments(payments, 'hidden')).toHaveLength(payments.length - 4)
  })

  it('an empty list stays empty', () => {
    expect(filterPayments([], 'listed')).toEqual([])
  })
})
