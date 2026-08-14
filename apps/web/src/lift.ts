export const LIFT_MS = 280
export const STAGGER_MS = 40

export type LiftSchedule = { starts: number[]; end: number; settled: number }

// Groups lift one after another (rows, then months, then totals); within a
// group each bar starts STAGGER_MS after the previous one.
export function liftSchedule(groupSizes: readonly number[]): LiftSchedule {
  const starts: number[] = []
  let at = 0
  for (const size of groupSizes) {
    starts.push(at)
    at += size * STAGGER_MS
  }
  return { starts, end: at, settled: at + LIFT_MS }
}
