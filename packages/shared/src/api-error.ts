import { z } from 'zod'

export const API_ERROR_CODES = [
  'INVALID_INPUT',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL',
] as const

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES)

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

// A relay refusal is not a separate code but `INVALID_INPUT` with the reason in `details.reason`.
export const apiErrorDetailsSchema = z.looseObject({ reason: z.string().optional() })

export type ApiErrorDetails = z.infer<typeof apiErrorDetailsSchema>

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string(),
  details: apiErrorDetailsSchema.optional(),
})

export const apiErrorBodySchema = z.object({ error: apiErrorSchema })

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>

export function apiResponseSchema<T extends z.ZodType>(data: T) {
  return z.union([z.object({ data }), apiErrorBodySchema])
}

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly details: ApiErrorDetails | undefined

  constructor(code: ApiErrorCode, message: string, details?: ApiErrorDetails) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }

  toBody(): ApiErrorBody {
    const { code, message, details } = this
    return { error: details === undefined ? { code, message } : { code, message, details } }
  }
}
