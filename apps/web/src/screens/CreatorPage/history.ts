import type { CreatorProfile } from '@ccsupport/shared'

export type HistoryColumn = {
  month: string
  short: string
  long: string
  active: number
  // Percent of the chart height; the tallest column stops short of the top so its label fits.
  height: number
  running: boolean
}

const TALLEST = 84

const nameOf = (month: string, style: 'short' | 'long'): string => {
  const [year = 0, index = 1] = month.split('-').map(Number)
  const at = new Date(Date.UTC(year, index - 1, 1))
  return style === 'short'
    ? at.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    : at.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// Months before the first supporter are dropped: a new creator's page would otherwise
// open on a row of zeros that says nothing about them.
export function historyColumns(series: CreatorProfile['series']): HistoryColumn[] {
  const first = series.findIndex((m) => m.active > 0)
  if (first === -1) return []
  const shown = series.slice(first)
  const max = Math.max(...shown.map((m) => m.active))
  return shown.map((m, i) => ({
    month: m.month,
    short: nameOf(m.month, 'short'),
    long: nameOf(m.month, 'long'),
    active: m.active,
    height: m.active === 0 ? 0 : Math.max(1, Math.round((m.active / max) * TALLEST)),
    running: i === shown.length - 1,
  }))
}
