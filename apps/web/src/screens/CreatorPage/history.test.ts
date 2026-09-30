import { describe, expect, it } from 'vitest'
import { historyColumns } from './history.ts'

const month = (m: string, active: number) => ({ month: m, active })

describe('historyColumns', () => {
  it('starts at the first month with a supporter and scales columns to the busiest month', () => {
    const columns = historyColumns([
      month('2025-10', 0),
      month('2025-11', 0),
      month('2025-12', 2),
      month('2026-01', 8),
      month('2026-02', 4),
    ])
    expect(columns.map((c) => c.month)).toEqual(['2025-12', '2026-01', '2026-02'])
    expect(columns.map((c) => c.active)).toEqual([2, 8, 4])
    expect(columns.map((c) => c.height)).toEqual([21, 84, 42])
  })

  it('names months in UTC — short under the column, with the year in the table', () => {
    const [dec, jan] = historyColumns([month('2025-12', 1), month('2026-01', 1)])
    expect(dec).toMatchObject({ short: 'Dec', long: 'December 2025' })
    expect(jan).toMatchObject({ short: 'Jan', long: 'January 2026' })
  })

  it('marks only the last month as running, since the api ends the series at its own today', () => {
    const columns = historyColumns([month('2026-08', 3), month('2026-09', 5)])
    expect(columns.map((c) => c.running)).toEqual([false, true])
  })

  it('keeps an empty month between two supported ones at zero height', () => {
    const columns = historyColumns([month('2026-06', 4), month('2026-07', 0), month('2026-08', 1)])
    expect(columns.map((c) => [c.active, c.height])).toEqual([
      [4, 84],
      [0, 0],
      [1, 21],
    ])
  })

  it('gives a lone supporter among many a visible column', () => {
    const [one] = historyColumns([month('2026-08', 1), month('2026-09', 900)])
    expect(one?.height).toBe(1)
  })

  it('returns nothing for a creator nobody has supported yet, and for an empty series', () => {
    expect(historyColumns([month('2026-08', 0), month('2026-09', 0)])).toEqual([])
    expect(historyColumns([])).toEqual([])
  })
})
