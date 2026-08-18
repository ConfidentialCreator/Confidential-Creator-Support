import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppEnv } from './env.ts'
import { type Logger, requestLogger } from './logger.ts'
import { errorHandler, notFoundHandler } from './middleware/errors.ts'
import { type RateLimitOptions, rateLimit } from './middleware/rate-limit.ts'
import { type HealthDeps, healthRoute } from './routes/health.ts'

export type AppDeps = {
  logger: Logger
  webOrigin: string
  health: HealthDeps
  rateLimit?: RateLimitOptions
}

// Dependencies come in as an argument: /health is testable without an RPC, the
// limiter without waiting a minute.
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()

  app.use('*', requestLogger(deps.logger))
  app.use('*', cors({ origin: deps.webOrigin, allowHeaders: ['Content-Type'] }))
  // Only the paths that spend the payer's SOL (PLAN → API); /health stays outside
  // so the Railway probe is never throttled by us.
  app.use('/relay/*', rateLimit(deps.rateLimit))

  app.notFound(notFoundHandler)
  app.onError(errorHandler)

  return app.route('/', healthRoute(deps.health))
}

export type App = ReturnType<typeof createApp>
