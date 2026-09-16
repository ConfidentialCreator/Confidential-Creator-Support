import { z } from 'zod'
import { addressSchema } from '../address.ts'
import { handleSchema } from '../handle.ts'
import { MAX_PERIODS } from '../periods.ts'

export const PAGE_LIMIT_DEFAULT = 50
export const PAGE_LIMIT_MAX = 100

// The cursor is opaque to the client: its shape is the API's business.
export const pageQuerySchema = z.object({
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).prefault(PAGE_LIMIT_DEFAULT),
})

export type PageQuery = z.infer<typeof pageQuerySchema>

const counter = z.number().int().nonnegative()
// u64 does not fit a number — a string of decimal digits, as in numeric(20,0).
const u64String = z.string().regex(/^\d+$/)
const slot = z.number().int().nonnegative()
const isoTime = z.iso.datetime()
// Half of the recipient's grouped ciphertext is exactly 128 bytes.
const ciphertextHalf = z.base64().length(172)

export const creatorProfileSchema = z.object({
  wallet: addressSchema,
  handle: handleSchema,
  name: z.string(),
  description: z.string(),
  suggestedAmount: u64String,
  createdSlot: slot,
  activeSupporters: counter,
  totalSupporters: counter,
})

export type CreatorProfile = z.infer<typeof creatorProfileSchema>

// `count` counts every active supporter, hidden ones included; `items` lists only
// those who allowed their wallet to be shown.
export const creatorSupportersSchema = z.object({
  count: counter,
  items: z.array(z.object({ wallet: addressSchema, since: isoTime, expiresAt: isoTime })),
  nextCursor: z.string().nullable(),
})

export type CreatorSupporters = z.infer<typeof creatorSupportersSchema>

export const creatorContributionsSchema = z.object({
  items: z.array(
    z.object({
      sig: z.string().min(1),
      supporter: addressSchema,
      slot,
      blockTime: isoTime,
      periods: z.number().int().min(1).max(MAX_PERIODS),
      groupedLo: ciphertextHalf,
      groupedHi: ciphertextHalf,
    }),
  ),
  nextCursor: z.string().nullable(),
})

export type CreatorContributions = z.infer<typeof creatorContributionsSchema>
