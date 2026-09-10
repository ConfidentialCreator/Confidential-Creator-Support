import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppEnv } from './env.ts'
import { type Logger, requestLogger } from './logger.ts'
import { errorHandler, notFoundHandler } from './middleware/errors.ts'
import { type RateLimitOptions, rateLimit } from './middleware/rate-limit.ts'
import { type CreatorsDeps, creatorsRoute } from './routes/creators.ts'
import { type DevnetDeps, devnetRoute } from './routes/devnet.ts'
import { type HealthDeps, healthRoute } from './routes/health.ts'
import { type RelayDeps, relayRoute } from './routes/relay.ts'

export type AppDeps = {
  logger: Logger
  webOrigin: string
  health: HealthDeps
  relay: RelayDeps
  // Absent in the demo process, which has no index of its own.
  creators?: CreatorsDeps
  // Absent outside devnet: the route is not mounted, so /devnet/faucet is a plain 404.
  devnet?: DevnetDeps
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

  const routed = app.route('/', healthRoute(deps.health)).route('/', relayRoute(deps.relay))
  const withCreators = deps.creators ? routed.route('/', creatorsRoute(deps.creators)) : routed
  return deps.devnet ? withCreators.route('/', devnetRoute(deps.devnet)) : withCreators
}

export type App = ReturnType<typeof createApp>
