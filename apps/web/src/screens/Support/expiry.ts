import { extendExpiry } from '@ccsupport/shared'

export type ExpiryPlan =
  | { kind: 'first'; until: number }
  | { kind: 'renewal'; from: number; until: number }
  | { kind: 'lapsed'; endedAt: number; until: number }

// The same `extendExpiry` as the program, fed by the browser clock: exact for a renewal
// of an active pledge, off by the chain clock skew only when the term restarts now.
export function expiryPlan(
  now: number,
  current: { expiresAt: number } | null,
  periods: number,
): ExpiryPlan {
  if (current === null) return { kind: 'first', until: extendExpiry(now, 0, periods) }
  const until = extendExpiry(now, current.expiresAt, periods)
  if (current.expiresAt > now) return { kind: 'renewal', from: current.expiresAt, until }
  return { kind: 'lapsed', endedAt: current.expiresAt, until }
}

export function formatExpiry(seconds: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(seconds * 1000)
}

export function expiryLines(plan: ExpiryPlan, format: (seconds: number) => string): string[] {
  switch (plan.kind) {
    case 'first':
      return [`Your support will run until ${format(plan.until)}.`]
    case 'renewal':
      return [
        `Your support runs until ${format(plan.from)}.`,
        `This renewal extends it from that date, not from today — until ${format(plan.until)}.`,
      ]
    case 'lapsed':
      return [
        `Your support ended on ${format(plan.endedAt)}.`,
        `A renewal now starts from today — until ${format(plan.until)}.`,
      ]
  }
}
