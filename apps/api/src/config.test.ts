import { getBase58Decoder } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { apiConfigFromEnv, DEFAULT_PORT } from './config.ts'

// Any 64 bytes pass config: the keypair itself is built in main.ts.
const secret = (fill: number) => getBase58Decoder().decode(new Uint8Array(64).fill(fill))
const PAYER = secret(1)
const FAUCET = secret(2)
const MINT = 'HApEuJSUaLofM9Z7PUhAKfxpHkapxBTmpdsnjG9nud36'

const base = {
  SOLANA_RPC_URL: 'https://api.devnet.solana.com',
  DATABASE_URL: 'postgres://postgres.x:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
  WEB_ORIGIN: 'http://localhost:5173',
  PROOF_PAYER_SECRET: PAYER,
}

describe('apiConfigFromEnv', () => {
  it('parses a filled-in environment with defaults', () => {
    const config = apiConfigFromEnv(base)
    expect(config.port).toBe(DEFAULT_PORT)
    expect(config.logLevel).toBe('info')
    expect(config.webOrigin).toBe('http://localhost:5173')
    expect(config.rpcUrl).toBe('https://api.devnet.solana.com')
    expect(config.proofPayerSecret).toHaveLength(64)
    expect(config.faucet).toBeNull()
  })

  it('runs the worker in-process only when RUN_WORKER says so', () => {
    expect(apiConfigFromEnv(base).worker).toBe(false)
    expect(apiConfigFromEnv({ ...base, RUN_WORKER: 'true' }).worker).toBe(true)
    expect(apiConfigFromEnv({ ...base, RUN_WORKER: 'no' }).worker).toBe(false)
  })

  it('falls back to the PORT a hosting platform assigns, API_PORT winning', () => {
    expect(apiConfigFromEnv({ ...base, PORT: '10000' }).port).toBe(10_000)
    expect(apiConfigFromEnv({ ...base, PORT: '10000', API_PORT: '9000' }).port).toBe(9_000)
  })

  it('coerces the port and the log level', () => {
    const config = apiConfigFromEnv({ ...base, API_PORT: '9000', LOG_LEVEL: 'debug' })
    expect(config.port).toBe(9000)
    expect(config.logLevel).toBe('debug')
  })

  it('requires FAUCET_SECRET and CCS_MINT only when the faucet is enabled', () => {
    expect(
      apiConfigFromEnv({ ...base, FAUCET_ENABLED: 'false', FAUCET_SECRET: '' }).faucet,
    ).toBeNull()
    expect(() => apiConfigFromEnv({ ...base, FAUCET_ENABLED: 'true' })).toThrow(/FAUCET_SECRET/)
    expect(() =>
      apiConfigFromEnv({ ...base, FAUCET_ENABLED: 'true', FAUCET_SECRET: FAUCET }),
    ).toThrow(/CCS_MINT/)
    expect(() =>
      apiConfigFromEnv({ ...base, FAUCET_ENABLED: 'true', FAUCET_SECRET: FAUCET, CCS_MINT: 'x' }),
    ).toThrow(/CCS_MINT/)
    const enabled = apiConfigFromEnv({
      ...base,
      FAUCET_ENABLED: 'true',
      FAUCET_SECRET: FAUCET,
      CCS_MINT: MINT,
    })
    expect(enabled.faucet?.secret).toHaveLength(64)
    expect(enabled.faucet?.mint).toBe(MINT)
  })

  it('refuses an empty value and a placeholder left from .env.example', () => {
    expect(() => apiConfigFromEnv({ ...base, SOLANA_RPC_URL: '' })).toThrow()
    expect(() => apiConfigFromEnv({ ...base, PROOF_PAYER_SECRET: 'REPLACE_ME' })).toThrow(
      /REPLACE_ME/,
    )
    expect(() => apiConfigFromEnv({ ...base, PROOF_PAYER_SECRET: undefined })).toThrow()
  })

  it('refuses a secret that is not a 64-byte base58 keypair', () => {
    expect(() => apiConfigFromEnv({ ...base, PROOF_PAYER_SECRET: PAYER.slice(0, 40) })).toThrow(
      /64 bytes/,
    )
    expect(() => apiConfigFromEnv({ ...base, PROOF_PAYER_SECRET: '0OIl' })).toThrow(/base58/)
  })

  it('refuses a bad origin, a non-http rpc url, a non-postgres database url and a bad port', () => {
    expect(() => apiConfigFromEnv({ ...base, WEB_ORIGIN: 'localhost' })).toThrow()
    expect(() => apiConfigFromEnv({ ...base, SOLANA_RPC_URL: 'ws://x' })).toThrow()
    expect(() => apiConfigFromEnv({ ...base, DATABASE_URL: 'https://x' })).toThrow()
    expect(() => apiConfigFromEnv({ ...base, DATABASE_URL: undefined })).toThrow()
    expect(() => apiConfigFromEnv({ ...base, API_PORT: '70000' })).toThrow()
  })
})
