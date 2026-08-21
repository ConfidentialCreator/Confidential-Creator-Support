import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  type KeyPairSigner,
} from '@solana/kit'
import { ElGamalKeypair, ElGamalSecretKey } from '@solana/zk-sdk'
import { z } from 'zod'

export const DEFAULT_KEYS_DIR = join(homedir(), '.config', 'ccsupport')
export const MINT_AUTHORITY_FILE = 'mint-authority.json'
export const AUDITOR_FILE = 'auditor-elgamal.json'

const SEED_BYTES = 32
const KEYPAIR_BYTES = 64

const byteArray = (length: number) => z.array(z.number().int().min(0).max(255)).length(length)

function readKeyFile(path: string, length: number): Uint8Array | null {
  if (!existsSync(path)) return null
  const parsed = byteArray(length).safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) throw new Error(`${path}: expected a JSON array of ${length} bytes`)
  return new Uint8Array(parsed.data)
}

function writeKeyFile(path: string, bytes: Uint8Array): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify([...bytes]), { flag: 'wx', mode: 0o600 })
}

// Same 64-byte layout as `solana-keygen` (seed ‖ pubkey), so the file also works with
// the Solana CLI for a manual `mint-to` or an authority transfer.
export async function loadOrCreateMintAuthority(
  dir: string,
): Promise<{ signer: KeyPairSigner; created: boolean }> {
  const path = join(dir, MINT_AUTHORITY_FILE)
  const stored = readKeyFile(path, KEYPAIR_BYTES)
  if (stored) return { signer: await createKeyPairSignerFromBytes(stored), created: false }

  const seed = new Uint8Array(randomBytes(SEED_BYTES))
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed)
  const bytes = new Uint8Array(KEYPAIR_BYTES)
  bytes.set(seed)
  bytes.set(getAddressEncoder().encode(signer.address), SEED_BYTES)
  writeKeyFile(path, bytes)
  return { signer, created: true }
}

export function loadOrCreateAuditor(dir: string): { keypair: ElGamalKeypair; created: boolean } {
  const path = join(dir, AUDITOR_FILE)
  const stored = readKeyFile(path, SEED_BYTES)
  if (stored) {
    return {
      keypair: ElGamalKeypair.fromSecretKey(ElGamalSecretKey.fromBytes(stored)),
      created: false,
    }
  }

  const keypair = new ElGamalKeypair()
  writeKeyFile(path, keypair.secret().toBytes())
  return { keypair, created: true }
}
