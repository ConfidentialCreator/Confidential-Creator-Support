import { describe, expect, it } from 'vitest'
import { parseWebEnv } from './config.ts'

const MINT = 'So11111111111111111111111111111111111111112'

describe('parseWebEnv', () => {
  it('reads the api url and the mint', () => {
    const env = parseWebEnv({
      VITE_API_URL: 'http://localhost:8787',
      VITE_CCS_MINT: MINT,
      VITE_SOLANA_RPC_URL: 'https://rpc.example',
      VITE_SOLANA_CLUSTER: 'localnet',
    })
    expect(env).toEqual({
      apiUrl: 'http://localhost:8787',
      mint: MINT,
      rpcUrl: 'https://rpc.example',
      chain: 'solana:localnet',
    })
  })

  it('falls back to the local api, public devnet and no mint when the variables are empty', () => {
    const fallback = {
      apiUrl: 'http://localhost:8787',
      mint: undefined,
      rpcUrl: 'https://api.devnet.solana.com',
      chain: 'solana:devnet',
    }
    expect(parseWebEnv({ VITE_API_URL: '', VITE_CCS_MINT: '', VITE_SOLANA_RPC_URL: '' })).toEqual(
      fallback,
    )
    expect(parseWebEnv({})).toEqual(fallback)
  })

  it('rejects a mint that is not an address and an api url that is not http', () => {
    expect(() => parseWebEnv({ VITE_CCS_MINT: 'not-an-address' })).toThrow()
    expect(() => parseWebEnv({ VITE_API_URL: 'ftp://x' })).toThrow()
    expect(() => parseWebEnv({ VITE_SOLANA_RPC_URL: 'wss://x' })).toThrow()
    expect(() => parseWebEnv({ VITE_SOLANA_CLUSTER: 'mainnet-beta' })).toThrow()
  })
})
