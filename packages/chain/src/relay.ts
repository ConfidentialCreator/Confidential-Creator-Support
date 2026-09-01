import {
  ApiError,
  type ApiErrorBody,
  addressSchema,
  apiResponseSchema,
  relayRequestSchema,
  relaySignaturesSchema,
} from '@ccsupport/shared'
import {
  type Address,
  type Base64EncodedWireTransaction,
  type Signature,
  signature,
} from '@solana/kit'
import { z } from 'zod'

const healthSchema = apiResponseSchema(z.looseObject({ payer: addressSchema }))
const signaturesSchema = apiResponseSchema(relaySignaturesSchema)

function unwrap<T>(body: { data: T } | ApiErrorBody): T {
  if ('data' in body) return body.data
  throw new ApiError(body.error.code, body.error.message, body.error.details)
}

async function relay(
  baseUrl: string,
  path: '/relay/proofs' | '/relay/close',
  transactions: Base64EncodedWireTransaction[],
  fetchImpl: typeof fetch,
): Promise<Signature[]> {
  const body = relayRequestSchema.parse({ transactions })
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return unwrap(signaturesSchema.parse(await response.json())).signatures.map(signature)
}

export const relayProofs = (
  baseUrl: string,
  transactions: Base64EncodedWireTransaction[],
  fetchImpl: typeof fetch = fetch,
) => relay(baseUrl, '/relay/proofs', transactions, fetchImpl)

export const relayClose = (
  baseUrl: string,
  transactions: Base64EncodedWireTransaction[],
  fetchImpl: typeof fetch = fetch,
) => relay(baseUrl, '/relay/close', transactions, fetchImpl)

export async function fetchRelayPayer(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Address> {
  const response = await fetchImpl(`${baseUrl}/health`)
  return unwrap(healthSchema.parse(await response.json())).payer
}
