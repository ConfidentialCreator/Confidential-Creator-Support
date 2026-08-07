// Константи періоду й grace дублюються в програмі (`programs/ccsupport`) і в
// SQL-запитах індексу; фікстура `fixtures/periods.json` звіряє всі три.
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
