import type { Logger } from './logger.ts'

export type AppEnv = {
  Variables: {
    logger: Logger
    requestId: string
  }
}
