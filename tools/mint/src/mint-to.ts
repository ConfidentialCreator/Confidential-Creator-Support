import { type Address, addressSchema } from '@ccsupport/shared'
import type { InstructionPlan, KeyPairSigner } from '@solana/kit'
import {
  getMintToATAInstructionPlanAsync,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022'
import { z } from 'zod'

const U64_MAX = 18_446_744_073_709_551_615n

const unitsSchema = z
  .string({ error: 'expected an integer amount in base units' })
  .regex(/^[0-9]+$/, 'expected an integer amount in base units')
  .transform((value) => BigInt(value))
  .refine((value) => value > 0n && value <= U64_MAX, 'expected 1..u64::MAX')

const mintToArgsSchema = z.object({ wallet: addressSchema, units: unitsSchema })

export type MintToArgs = z.infer<typeof mintToArgsSchema>

export function parseMintToArgs(argv: readonly string[]): MintToArgs {
  const parsed = mintToArgsSchema.safeParse({ wallet: argv[0], units: argv[1] })
  if (!parsed.success) {
    throw new Error(`usage: mint-to <wallet> <units>\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

export type MintToInput = MintToArgs & {
  authority: KeyPairSigner
  mint: Address
  decimals: number
}

export function mintToPlan({
  authority,
  mint,
  decimals,
  wallet,
  units,
}: MintToInput): Promise<InstructionPlan> {
  return getMintToATAInstructionPlanAsync(
    { payer: authority, owner: wallet, mint, mintAuthority: authority, amount: units, decimals },
    { tokenProgram: TOKEN_2022_PROGRAM_ADDRESS },
  )
}
