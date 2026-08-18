import { ApiError, type ApiErrorCode, type ApiErrorDetails } from '@ccsupport/shared'
import type { Context, Env, ErrorHandler, NotFoundHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from '../env.ts'

// The code → status map lives here and not in `shared`: the browser never needs it.
const HTTP_STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL: 500,
}

const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  400: 'INVALID_INPUT',
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
}

export function fail<E extends Env, P extends string>(
  c: Context<E, P>,
  code: ApiErrorCode,
  message: string,
  details?: ApiErrorDetails,
) {
  return c.json(new ApiError(code, message, details).toBody(), HTTP_STATUS[code])
}

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  fail(c, 'NOT_FOUND', 'no route matches this path')

// Nothing but INTERNAL leaves the process for an unexpected error: exception
// messages carry connection strings and RPC urls with keys. The cause stays in the
// log, joined to the response by requestId.
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const logger = c.get('logger')
  if (err instanceof ApiError) {
    logger?.warn({ err, code: err.code }, 'request rejected')
    return fail(c, err.code, err.message, err.details)
  }
  if (err instanceof HTTPException) {
    const code = CODE_BY_STATUS[err.status]
    if (code !== undefined) {
      logger?.warn({ err, status: err.status }, 'request rejected')
      return fail(c, code, err.message)
    }
  }
  logger?.error({ err }, 'unhandled error')
  return fail(c, 'INTERNAL', 'internal error')
}
