import { z } from 'zod'

// The program checks the same pattern (the `Handle` PDA seed); `fixtures/handle.json` cross-checks both.
export const HANDLE_PATTERN = /^[a-z0-9-]{3,32}$/

export const handleSchema = z.string().regex(HANDLE_PATTERN)

export type Handle = z.infer<typeof handleSchema>
