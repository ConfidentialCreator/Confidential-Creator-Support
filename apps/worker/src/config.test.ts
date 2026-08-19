import { describe, expect, it } from 'vitest'
import { workerConfigFromEnv, wsUrlFor } from './config.ts'

const base = {
  DATABASE_URL: 'postgres://postgres.x:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
  SOLANA_RPC_URL: 'https://devnet.helius-rpc.com/?api-key=k',
}

describe('wsUrlFor', () => {
  it('keeps host, path and query — the key travels in the query on Helius', () => {
    expect(wsUrlFor('https://devnet.helius-rpc.com/?api-key=k')).toBe(
      'wss://devnet.helius-rpc.com/?api-key=k',
    )
    expect(wsUrlFor('http://127.0.0.1:8899')).toBe('ws://127.0.0.1:8899/')
  })
})

describe('workerConfigFromEnv', () => {
  it('parses a filled-in environment and derives the websocket url', () => {
    const config = workerConfigFromEnv(base)
    expect(config.logLevel).toBe('info')
    expect(config.wsUrl).toBe('wss://devnet.helius-rpc.com/?api-key=k')
    expect(config.databaseUrl).toBe(base.DATABASE_URL)
  })

  it('refuses an empty value, a placeholder and a non-http rpc url', () => {
    expect(() => workerConfigFromEnv({ ...base, DATABASE_URL: '' })).toThrow()
    expect(() => workerConfigFromEnv({ ...base, DATABASE_URL: 'REPLACE_ME' })).toThrow(/REPLACE_ME/)
    expect(() => workerConfigFromEnv({ ...base, SOLANA_RPC_URL: 'wss://x' })).toThrow()
    expect(() => workerConfigFromEnv({ SOLANA_RPC_URL: base.SOLANA_RPC_URL })).toThrow()
  })
})
