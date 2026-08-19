import { describe, expect, it } from 'vitest'
import { parseWebEnv } from './config.ts'

const MINT = 'So11111111111111111111111111111111111111112'

describe('parseWebEnv', () => {
  it('reads the api url and the mint', () => {
    const env = parseWebEnv({ VITE_API_URL: 'http://localhost:8787', VITE_CCS_MINT: MINT })
    expect(env).toEqual({ apiUrl: 'http://localhost:8787', mint: MINT })
  })

  it('falls back to the local api and no mint when the variables are empty', () => {
    expect(parseWebEnv({ VITE_API_URL: '', VITE_CCS_MINT: '' })).toEqual({
      apiUrl: 'http://localhost:8787',
      mint: undefined,
    })
    expect(parseWebEnv({})).toEqual({ apiUrl: 'http://localhost:8787', mint: undefined })
  })

  it('rejects a mint that is not an address and an api url that is not http', () => {
    expect(() => parseWebEnv({ VITE_CCS_MINT: 'not-an-address' })).toThrow()
    expect(() => parseWebEnv({ VITE_API_URL: 'ftp://x' })).toThrow()
  })
})
