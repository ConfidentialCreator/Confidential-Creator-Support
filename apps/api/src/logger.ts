import type { MiddlewareHandler } from 'hono'
import { type Logger as PinoLogger, pino } from 'pino'
import type { LogLevel } from './config.ts'
import type { AppEnv } from './env.ts'

export type Logger = PinoLogger

// One JSON line per event on stdout; Railway collects it. Pretty-printing is the
// developer's pipe (`pino-pretty`), not a dependency of the service.
export function createLogger(level: LogLevel): Logger {
  return pino({
    level,
    base: { service: 'api' },
    timestamp: pino.stdTimeFunctions.isoTime,
  })
}

export const REQUEST_ID_HEADER = 'x-request-id'

export function requestLogger(
  logger: Logger,
  now: () => number = () => Date.now(),
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const requestId = c.req.header(REQUEST_ID_HEADER) ?? crypto.randomUUID()
    const child = logger.child({ requestId })
    c.set('requestId', requestId)
    c.set('logger', child)
    c.header(REQUEST_ID_HEADER, requestId)

    const startedAt = now()
    await next()
    // Path without the query string: wallets travel in query parameters.
    child.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: now() - startedAt,
      },
      'request',
    )
  }
}
