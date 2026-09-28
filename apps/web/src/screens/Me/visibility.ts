import { pledgePda } from '@ccsupport/chain'
import type { Address } from '@solana/kit'

export type FetchFlags = (pledges: Address[]) => Promise<(boolean | null)[]>

// The flag is read from the Pledge PDAs, not the index: right after a toggle the index
// is seconds behind, and the chain is what the program will overwrite next.
export async function readVisibility(
  fetchFlags: FetchFlags,
  supporter: Address,
  creators: readonly Address[],
): Promise<Map<Address, boolean | null>> {
  if (creators.length === 0) return new Map()
  const pdas = await Promise.all(creators.map(async (c) => (await pledgePda(c, supporter))[0]))
  const flags = await fetchFlags(pdas)
  return new Map(creators.map((c, i) => [c, flags[i] ?? null]))
}
