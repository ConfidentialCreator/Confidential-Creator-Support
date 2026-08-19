import { z } from 'zod'

const healthSchema = z.object({
  data: z.union([
    z.object({ ok: z.literal(true), slot: z.number(), payerLamports: z.number() }),
    z.object({ ok: z.literal(false), slot: z.null(), payerLamports: z.null() }),
  ]),
})

export type Health = z.infer<typeof healthSchema>['data']

// A 503 with `ok: false` is a valid answer, not a failure — the api is up, its RPC is not.
export async function fetchHealth(
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Health> {
  const response = await fetchImpl(`${apiUrl}/health`)
  return healthSchema.parse(await response.json()).data
}
