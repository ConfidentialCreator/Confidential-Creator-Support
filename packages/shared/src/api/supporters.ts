import { z } from 'zod'
import { addressSchema } from '../address.ts'
import { handleSchema } from '../handle.ts'

// Every pledge of the wallet, lapsed ones included: the history stays after the grace
// window, only `active` turns false.
export const supporterPledgesSchema = z.array(
  z.object({
    creator: addressSchema,
    handle: handleSchema,
    name: z.string(),
    expiresAt: z.iso.datetime(),
    active: z.boolean(),
    daysLeft: z.number().int().nonnegative(),
    contributions: z.number().int().min(1),
  }),
)

export type SupporterPledges = z.infer<typeof supporterPledgesSchema>
