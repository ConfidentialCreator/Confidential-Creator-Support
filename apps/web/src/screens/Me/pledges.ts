import { GRACE_SECONDS } from '@ccsupport/shared'

export const SOON_DAYS = 7

type Row = { active: boolean; daysLeft: number; expiresAt: string }

export type Standing = 'running' | 'soon' | 'grace' | 'ended'

// `daysLeft` counts only the paid term, so an active pledge at 0 is inside the grace window.
export function standing(row: Pick<Row, 'active' | 'daysLeft'>): Standing {
  if (!row.active) return 'ended'
  if (row.daysLeft === 0) return 'grace'
  return row.daysLeft <= SOON_DAYS ? 'soon' : 'running'
}

export function reminder(row: Row, format: (seconds: number) => string): string {
  const expiresAt = Date.parse(row.expiresAt) / 1000
  const days = `${row.daysLeft} ${row.daysLeft === 1 ? 'day' : 'days'}`
  switch (standing(row)) {
    case 'running':
      return `Ends in ${days} — ${format(expiresAt)}`
    case 'soon':
      return `Ends in ${days} — ${format(expiresAt)}. Renew to keep it running.`
    case 'grace':
      return `The paid term ended on ${format(expiresAt)}. Renew before ${format(expiresAt + GRACE_SECONDS)} to stay counted.`
    case 'ended':
      return `Ended on ${format(expiresAt)}`
  }
}

export function splitPledges<T extends Row>(rows: readonly T[]): { current: T[]; ended: T[] } {
  return {
    current: rows.filter((r) => r.active),
    ended: rows.filter((r) => !r.active).reverse(),
  }
}
