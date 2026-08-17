import { z } from 'zod'

// Той самий патерн перевіряє програма (seed `Handle` PDA); `fixtures/handle.json` звіряє обидва.
export const HANDLE_PATTERN = /^[a-z0-9-]{3,32}$/

export const handleSchema = z.string().regex(HANDLE_PATTERN)

export type Handle = z.infer<typeof handleSchema>
