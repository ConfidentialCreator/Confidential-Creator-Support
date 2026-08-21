import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AUDITOR_FILE,
  loadOrCreateAuditor,
  loadOrCreateMintAuthority,
  MINT_AUTHORITY_FILE,
} from './keys.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccs-keys-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadOrCreateMintAuthority', () => {
  it('generates a 64-byte keypair file on first run and reloads the same signer after', async () => {
    const first = await loadOrCreateMintAuthority(dir)
    expect(first.created).toBe(true)

    const stored = JSON.parse(readFileSync(join(dir, MINT_AUTHORITY_FILE), 'utf8'))
    expect(stored).toHaveLength(64)

    const second = await loadOrCreateMintAuthority(dir)
    expect(second.created).toBe(false)
    expect(second.signer.address).toBe(first.signer.address)
  })

  it('creates the directory when it does not exist yet', async () => {
    const nested = join(dir, 'nested', 'deeper')
    const { signer } = await loadOrCreateMintAuthority(nested)
    expect(readFileSync(join(nested, MINT_AUTHORITY_FILE), 'utf8')).toContain('[')
    expect(signer.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
  })

  it('refuses a corrupt key file instead of overwriting it', async () => {
    writeFileSync(join(dir, MINT_AUTHORITY_FILE), JSON.stringify([1, 2, 3]))
    await expect(loadOrCreateMintAuthority(dir)).rejects.toThrow(MINT_AUTHORITY_FILE)
    expect(readFileSync(join(dir, MINT_AUTHORITY_FILE), 'utf8')).toBe('[1,2,3]')
  })
})

describe('loadOrCreateAuditor', () => {
  it('generates a 32-byte ElGamal secret on first run and reloads the same pubkey after', () => {
    const first = loadOrCreateAuditor(dir)
    expect(first.created).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, AUDITOR_FILE), 'utf8'))).toHaveLength(32)

    const second = loadOrCreateAuditor(dir)
    expect(second.created).toBe(false)
    expect(second.keypair.pubkey().toBytes()).toEqual(first.keypair.pubkey().toBytes())
  })

  it('refuses a key file that is not a byte array', () => {
    writeFileSync(join(dir, AUDITOR_FILE), JSON.stringify({ secret: 'nope' }))
    expect(() => loadOrCreateAuditor(dir)).toThrow(AUDITOR_FILE)
  })
})
