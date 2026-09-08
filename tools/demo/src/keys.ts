import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  getBase58Encoder,
  type KeyPairSigner,
} from '@solana/kit'
import { z } from 'zod'

export const DEFAULT_KEYS_DIR = join(homedir(), '.config', 'ccsupport')
export const CREATOR_FILE = 'demo-creator.json'

const SEED_BYTES = 32
const KEYPAIR_BYTES = 64

const keypairBytes = z.array(z.number().int().min(0).max(255)).length(KEYPAIR_BYTES)

// Розкладка `solana-keygen` (seed ‖ pubkey): той самий файл імпортується в гаманець
// браузера для сценарію автора.
export async function loadOrCreateKeypair(
  dir: string,
  name: string,
): Promise<{ signer: KeyPairSigner; created: boolean }> {
  const path = join(dir, name)
  if (existsSync(path)) {
    const parsed = keypairBytes.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    if (!parsed.success) throw new Error(`${path}: expected a JSON array of ${KEYPAIR_BYTES} bytes`)
    return {
      signer: await createKeyPairSignerFromBytes(new Uint8Array(parsed.data)),
      created: false,
    }
  }
  const seed = new Uint8Array(randomBytes(SEED_BYTES))
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed)
  const bytes = new Uint8Array(KEYPAIR_BYTES)
  bytes.set(seed)
  bytes.set(getAddressEncoder().encode(signer.address), SEED_BYTES)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify([...bytes]), { flag: 'wx', mode: 0o600 })
  return { signer, created: true }
}

export async function signerFromBase58(secret: string): Promise<KeyPairSigner> {
  const bytes = new Uint8Array(getBase58Encoder().encode(secret))
  if (bytes.length !== KEYPAIR_BYTES) {
    throw new Error(`expected a base58 keypair of ${KEYPAIR_BYTES} bytes, got ${bytes.length}`)
  }
  return createKeyPairSignerFromBytes(bytes)
}
