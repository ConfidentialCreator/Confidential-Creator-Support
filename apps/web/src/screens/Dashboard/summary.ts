import type { DecryptResult } from '@ccsupport/chain'
import { PERIOD_SECONDS } from '@ccsupport/shared'

// undefined — the worker has not answered yet.
export type AmountRow = { blockTime: string; amount: DecryptResult | undefined }

export type ReceivedTotals = {
  period: bigint
  periodCount: number
  lifetime: bigint
  decrypted: number
  failed: number
  pending: number
}

export function receivedTotals(rows: readonly AmountRow[], now: Date): ReceivedTotals {
  const periodStart = now.getTime() - PERIOD_SECONDS * 1000
  const totals: ReceivedTotals = {
    period: 0n,
    periodCount: 0,
    lifetime: 0n,
    decrypted: 0,
    failed: 0,
    pending: 0,
  }
  for (const row of rows) {
    if (row.amount === undefined) {
      totals.pending += 1
    } else if (!row.amount.ok) {
      totals.failed += 1
    } else {
      totals.decrypted += 1
      totals.lifetime += row.amount.units
      if (Date.parse(row.blockTime) >= periodStart) {
        totals.period += row.amount.units
        totals.periodCount += 1
      }
    }
  }
  return totals
}

const HALF_BYTES = 128

export function decodeHalf(base64: string): Uint8Array {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  if (bytes.length !== HALF_BYTES) {
    throw new RangeError(`ciphertext half is ${bytes.length} bytes, expected ${HALF_BYTES}`)
  }
  return bytes
}

export const formatSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`
