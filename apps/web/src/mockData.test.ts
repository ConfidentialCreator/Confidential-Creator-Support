import { describe, expect, it } from 'vitest'
import {
  AUDIT_KEY,
  endDate,
  generatedPayments,
  listed,
  months,
  payments,
  totals,
  trunc,
  withUnit,
} from './mockData.ts'

const sum = (rows: readonly { amount: string }[]) =>
  rows.reduce((acc, r) => acc + Number(r.amount.replace(',', '')), 0)

describe('generatedPayments', () => {
  const rows = generatedPayments()

  it('yields 36 rows summing to 349.00 by the fixed rule', () => {
    expect(rows).toHaveLength(36)
    expect(sum(rows).toFixed(2)).toBe('349.00')
  })

  it('first row is 5 h 13 min before 2026-09-11 17:20 and buys two periods', () => {
    expect(rows[0]).toEqual({
      when: '2026-09-11 12:07',
      wallet: 'G01xDemo5kR8nTz2xLb7cMd4fSg9hJv3yUa',
      periods: 2,
      until: '2026-11-10',
      listed: false,
      amount: '5.00',
    })
  })

  it('cycles periods 2,3,1 and amounts over the 8-entry list', () => {
    expect(rows.slice(0, 9).map((r) => r.periods)).toEqual([2, 3, 1, 2, 3, 1, 2, 3, 1])
    expect(rows.slice(0, 9).map((r) => r.amount)).toEqual([
      '5.00',
      '8.00',
      '8.00',
      '12.00',
      '3.00',
      '20.00',
      '8.00',
      '15.00',
      '5.00',
    ])
    expect(rows[35]?.wallet.startsWith('G36x')).toBe(true)
  })

  it('every generated row is unlisted', () => {
    expect(rows.every((r) => !r.listed)).toBe(true)
  })
})

describe('payments', () => {
  it('has 48 September rows summing to the September figure', () => {
    expect(payments).toHaveLength(totals.paymentsSeptember)
    expect(sum(payments).toFixed(2)).toBe(totals.september)
    expect(months[6]?.received).toBe(totals.september)
  })

  it('opens with the payment that just arrived', () => {
    expect(payments[0]?.wallet).toBe('Sup1QeXdDemo5kR8nTz2xLb7cMd4fSg9hJv3yUaW6pKm')
    expect(sum(payments.slice(0, 12)).toFixed(2)).toBe('255.00')
  })

  it('lists exactly the wallets that asked to be listed', () => {
    const listedWallets = new Set(listed.map((s) => s.wallet))
    const listedInSeptember = payments.filter((p) => p.listed).map((p) => p.wallet)
    expect(listedInSeptember).toHaveLength(4)
    expect(listedInSeptember.every((w) => listedWallets.has(w))).toBe(true)
  })
})

describe('months', () => {
  it('sums received to the lifetime figure and payments to 312', () => {
    expect(sum(months.map((m) => ({ amount: m.received }))).toFixed(2)).toBe('3870.00')
    expect(months.reduce((acc, m) => acc + m.payments, 0)).toBe(totals.paymentsAll)
    expect(months[6]?.active).toBe(totals.active)
  })
})

describe('endDate', () => {
  it.each([
    [1, '2026-10-15'],
    [2, '2026-11-14'],
    [3, '2026-12-14'],
    [6, '2027-03-14'],
    [12, '2027-09-10'],
  ])('%i periods end on %s', (periods, expected) => {
    expect(endDate(periods)).toBe(expected)
  })
})

describe('formatting', () => {
  it('truncates to four and four', () => {
    expect(trunc('Sup2Hv3lDemo9pQw3kR6nTz8xLb5cMd2fSg7hJv4yUb')).toBe('Sup2…4yUb')
  })

  it('appends the unit', () => {
    expect(withUnit('3,870.00')).toBe('3,870.00 SUPD')
  })

  it('audit key is 64 hex characters', () => {
    expect(AUDIT_KEY).toMatch(/^[0-9a-f]{64}$/)
  })
})
