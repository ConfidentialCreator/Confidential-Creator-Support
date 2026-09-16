import { z } from 'zod'

// One tx per proof; T006 showed ≤ 4 per transfer and 1 per close.
export const RELAY_MAX_TRANSACTIONS = 4

export const relayRequestSchema = z.object({
  transactions: z.array(z.base64()).min(1).max(RELAY_MAX_TRANSACTIONS),
})

export type RelayRequest = z.infer<typeof relayRequestSchema>

export const relaySignaturesSchema = z.object({ signatures: z.array(z.string().min(1)).min(1) })

export type RelaySignatures = z.infer<typeof relaySignaturesSchema>
