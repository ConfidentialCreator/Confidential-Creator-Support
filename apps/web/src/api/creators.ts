import {
  ApiError,
  apiErrorBodySchema,
  type CreatorProfile,
  type CreatorSupporters,
  creatorProfileSchema,
  creatorSupportersSchema,
} from '@ccsupport/shared'
import { z } from 'zod'

const envelope = z.object({ data: z.unknown() })

async function read<T extends z.ZodType>(
  url: string,
  schema: T,
  fetchImpl: typeof fetch,
): Promise<z.output<T>> {
  const response = await fetchImpl(url)
  const body: unknown = await response.json()
  const failure = apiErrorBodySchema.safeParse(body)
  if (failure.success) {
    const { code, message, details } = failure.data.error
    throw new ApiError(code, message, details)
  }
  return schema.parse(envelope.parse(body).data)
}

export async function fetchCreator(
  apiUrl: string,
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatorProfile | null> {
  try {
    return await read(`${apiUrl}/creators/${handle}`, creatorProfileSchema, fetchImpl)
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NOT_FOUND') return null
    throw err
  }
}

export function fetchSupporters(
  apiUrl: string,
  handle: string,
  cursor?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatorSupporters> {
  const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`
  return read(`${apiUrl}/creators/${handle}/supporters${query}`, creatorSupportersSchema, fetchImpl)
}
