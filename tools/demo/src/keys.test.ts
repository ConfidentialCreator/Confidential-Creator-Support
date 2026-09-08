import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getBase58Decoder } from '@solana/kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadOrCreateKeypair, signerFromBase58 } from './keys.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccs-demo-keys-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadOrCreateKeypair', () => {
  it('creates a solana-keygen keypair once and loads the same address afterwards', async () => {
    const first = await loadOrCreateKeypair(dir, 'k.json')
    const second = await loadOrCreateKeypair(dir, 'k.json')
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.signer.address).toBe(first.signer.address)
    const bytes = JSON.parse(readFileSync(join(dir, 'k.json'), 'utf8'))
    expect(bytes).toHaveLength(64)
  })

  it('reads the same file as the base58 form used in .env', async () => {
    const { signer } = await loadOrCreateKeypair(dir, 'k.json')
    const bytes = new Uint8Array(JSON.parse(readFileSync(join(dir, 'k.json'), 'utf8')))
    const fromEnv = await signerFromBase58(getBase58Decoder().decode(bytes))
    expect(fromEnv.address).toBe(signer.address)
  })

  it('rejects a file that is not a 64-byte array', async () => {
    writeFileSync(join(dir, 'bad.json'), JSON.stringify([1, 2, 3]))
    await expect(loadOrCreateKeypair(dir, 'bad.json')).rejects.toThrow('64 bytes')
  })
})

describe('signerFromBase58', () => {
  it('rejects a secret of the wrong length', async () => {
    await expect(signerFromBase58('11111111')).rejects.toThrow('64 bytes')
  })
})
