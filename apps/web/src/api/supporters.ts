import { type SupporterPledges, supporterPledgesSchema } from '@ccsupport/shared'
import { read } from './creators.ts'

export type SupporterPledge = SupporterPledges[number]

export function fetchSupporterPledges(
  apiUrl: string,
  wallet: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SupporterPledges> {
  return read(`${apiUrl}/supporters/${wallet}/pledges`, supporterPledgesSchema, fetchImpl)
}
