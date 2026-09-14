import {
  type Address,
  ApiError,
  apiErrorBodySchema,
  type FaucetResponse,
  faucetResponseSchema,
} from '@ccsupport/shared'
import { z } from 'zod'

const envelope = z.object({ data: z.unknown() })

export async function requestFaucet(
  apiUrl: string,
  wallet: Address,
  fetchImpl: typeof fetch = fetch,
): Promise<FaucetResponse> {
  const response = await fetchImpl(`${apiUrl}/devnet/faucet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet }),
  })
  const body: unknown = await response.json()
  const failure = apiErrorBodySchema.safeParse(body)
  if (failure.success) {
    const { code, message, details } = failure.data.error
    throw new ApiError(code, message, details)
  }
  return faucetResponseSchema.parse(envelope.parse(body).data)
}
