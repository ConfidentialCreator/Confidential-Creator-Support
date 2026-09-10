import { z } from 'zod'
import { addressSchema } from '../address.ts'
import { handleSchema } from '../handle.ts'
import { MAX_PERIODS } from '../periods.ts'

export const PAGE_LIMIT_DEFAULT = 50
export const PAGE_LIMIT_MAX = 100

// Курсор непрозорий для клієнта: його форма — справа API.
export const pageQuerySchema = z.object({
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).prefault(PAGE_LIMIT_DEFAULT),
})

export type PageQuery = z.infer<typeof pageQuerySchema>

const counter = z.number().int().nonnegative()
// u64 не вміщається в number — рядок десяткових цифр, як у numeric(20,0).
const u64String = z.string().regex(/^\d+$/)
const slot = z.number().int().nonnegative()
const isoTime = z.iso.datetime()
// Половина grouped-шифротексту одержувача — рівно 128 байтів.
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

// `count` рахує всіх активних прихильників, включно з прихованими; `items` — лише
// тих, хто дозволив показувати гаманець.
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
