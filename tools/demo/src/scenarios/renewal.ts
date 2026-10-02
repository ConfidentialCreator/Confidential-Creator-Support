import { PERIOD_SECONDS } from '@ccsupport/shared'
import { z } from 'zod'

// One reading of the live api: the supporter's own pledge and the creator's counter, taken
// together so a gap in either shows up at the same instant.
export type RenewalSample = {
  atMs: number
  active: boolean
  expiresAt: string
  activeSupporters: number
}

export const renewalVerdictSchema = z.object({
  samples: z.number().int(),
  // Readings where the pledge was reported lapsed — SC-005 allows none.
  inactive: z.number().int(),
  expectedExpiresAt: z.iso.datetime(),
  // Renewal confirmed → the api answers the new expiry; null when it never did.
  indexedMs: z.number().nullable(),
  counterBefore: z.number().int(),
  // Readings where the creator's active count differed from the one before the renewal.
  counterMoves: z.number().int(),
  pass: z.boolean(),
})

export type RenewalVerdict = z.infer<typeof renewalVerdictSchema>

// The renewal extends from the old expiry, not from now (T018): one period on top of it.
export function judgeRenewal(
  before: { expiresAt: string; activeSupporters: number },
  confirmedAtMs: number,
  samples: readonly RenewalSample[],
): RenewalVerdict {
  const expected = new Date(Date.parse(before.expiresAt) + PERIOD_SECONDS * 1000).toISOString()
  const renewed = samples.find(
    (s) => s.atMs >= confirmedAtMs && Date.parse(s.expiresAt) === Date.parse(expected),
  )
  const inactive = samples.filter((s) => !s.active).length
  const counterMoves = samples.filter((s) => s.activeSupporters !== before.activeSupporters).length
  const indexedMs = renewed ? renewed.atMs - confirmedAtMs : null
  return {
    samples: samples.length,
    inactive,
    expectedExpiresAt: expected,
    indexedMs,
    counterBefore: before.activeSupporters,
    counterMoves,
    // Readings on both sides of the transaction, or "no gap" was never observed.
    pass:
      samples.some((s) => s.atMs < confirmedAtMs) &&
      inactive === 0 &&
      indexedMs !== null &&
      counterMoves === 0,
  }
}
