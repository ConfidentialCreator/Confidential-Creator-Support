import { z } from 'zod'
import { addressSchema } from '../address.ts'

export const faucetRequestSchema = z.object({ wallet: addressSchema })

export type FaucetRequest = z.infer<typeof faucetRequestSchema>

// The portions are numbers: 0.02 SOL and 100 SUPD in base units fit a safe integer.
export const faucetResponseSchema = z.object({
  signature: z.string().min(1),
  lamports: z.number().int().positive(),
  units: z.number().int().positive(),
})

export type FaucetResponse = z.infer<typeof faucetResponseSchema>
