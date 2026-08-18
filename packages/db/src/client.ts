import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

// Supabase transaction pooler. Direct 5432 gives two connections for all services on
// the free tier, and it is IPv6-only — a wrong port fails later, in the other service.
export const POOLER_PORT = 6543
// api + worker share a handful of pooled connections; an in-process queue beats a
// refused connection in the neighbouring service.
export const POOL_MAX = 3
const IDLE_TIMEOUT_SECONDS = 20
const CONNECT_TIMEOUT_SECONDS = 10

export type Db = PostgresJsDatabase<typeof schema>

export type DbHandle = {
  db: Db
  sql: postgres.Sql
  ping: () => Promise<void>
  close: () => Promise<void>
}

function assertPooled(databaseUrl: string): void {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL is not a url')
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL is not a postgres:// connection string')
  }
  if (url.port !== String(POOLER_PORT)) {
    throw new Error(`DATABASE_URL must use the transaction pooler port ${POOLER_PORT}`)
  }
}

export function createDb(databaseUrl: string): DbHandle {
  assertPooled(databaseUrl)
  // pgbouncer in transaction mode hands the connection to another client between
  // queries, so a PREPARE made in one query does not exist in the next; the failure
  // shows up as `prepared statement "s1" does not exist` on a random query under load.
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: POOL_MAX,
    idle_timeout: IDLE_TIMEOUT_SECONDS,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
  })
  return {
    db: drizzle(sql, { schema }),
    sql,
    ping: async () => {
      await sql`select 1`
    },
    close: () => sql.end({ timeout: 5 }),
  }
}
