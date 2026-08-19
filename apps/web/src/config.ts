import { addressSchema } from '@ccsupport/shared'
import { z } from 'zod'

const blankAsMissing = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value))

const webEnvSchema = z.object({
  VITE_API_URL: blankAsMissing.pipe(
    z
      .url({ protocol: /^https?$/ })
      .optional()
      .transform((value) => value ?? 'http://localhost:8787'),
  ),
  VITE_CCS_MINT: blankAsMissing.pipe(addressSchema.optional()),
})

export type WebEnv = { apiUrl: string; mint: z.infer<typeof addressSchema> | undefined }

export function parseWebEnv(raw: Record<string, string | undefined>): WebEnv {
  const env = webEnvSchema.parse(raw)
  return { apiUrl: env.VITE_API_URL, mint: env.VITE_CCS_MINT }
}

export const webEnv = parseWebEnv(import.meta.env)
