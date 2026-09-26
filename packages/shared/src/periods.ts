// The period and grace constants are duplicated in the program (`programs/ccsupport`) and in
// the index SQL queries; the `fixtures/periods.json` fixture cross-checks all three.
export const PERIOD_SECONDS = 30 * 24 * 60 * 60
export const GRACE_SECONDS = 3 * 24 * 60 * 60
export const MAX_PERIODS = 12

export function extendExpiry(now: number, expiresAt: number, periods: number): number {
  if (!Number.isInteger(periods) || periods < 1 || periods > MAX_PERIODS) {
    throw new RangeError(`periods must be 1..${MAX_PERIODS}, got ${periods}`)
  }
  return Math.max(now, expiresAt) + periods * PERIOD_SECONDS
}

export function isActive(now: number, expiresAt: number): boolean {
  return expiresAt + GRACE_SECONDS > now
}

const DAY_SECONDS = 24 * 60 * 60

// Grace is not counted: a renewal extends from the old expiry, so grace days are paid by
// the next period rather than left over from this one.
export function daysLeft(now: number, expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / DAY_SECONDS))
}
