import {
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit'
import { ElGamalCiphertext, type ElGamalKeypair } from '@solana/zk-sdk'
import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  getConfidentialTransferInstructionDataDecoder,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022'
import { z } from 'zod'
import { elgamalFromSecret } from './decrypt.ts'

export type AuditFailure = 'invalid-key' | 'not-a-transfer' | 'malformed' | 'wrong-key'
export type AuditResult = { ok: true; units: bigint } | { ok: false; reason: AuditFailure }

const LO_BITS = 16n
// Same layout as the `auditor-elgamal.json` file `tools/mint` writes.
const secretSchema = z.array(z.number().int().min(0).max(255)).length(32)

const fail = (reason: AuditFailure): AuditResult => ({ ok: false, reason })

function parseAuditorKey(text: string): ElGamalKeypair | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const bytes = secretSchema.safeParse(json)
  if (!bytes.success) return null
  // The zero scalar panics inside wasm (`unreachable`); the instance survives it.
  try {
    return elgamalFromSecret(new Uint8Array(bytes.data))
  } catch {
    return null
  }
}

type AuditorCiphertext = { lo: Uint8Array; hi: Uint8Array }

function readAuditorCiphertext(wire: string): AuditorCiphertext | 'not-a-transfer' | 'malformed' {
  try {
    const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
    if (!('instructions' in message)) return 'not-a-transfer'
    const ix = message.instructions.find(
      (i) =>
        message.staticAccounts[i.programAddressIndex] === TOKEN_2022_PROGRAM_ADDRESS &&
        i.data?.[0] === CONFIDENTIAL_TRANSFER_DISCRIMINATOR &&
        i.data[1] === CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
    )
    if (!ix?.data) return 'not-a-transfer'
    const data = getConfidentialTransferInstructionDataDecoder().decode(ix.data)
    return {
      lo: new Uint8Array(data.transferAmountAuditorCiphertextLo),
      hi: new Uint8Array(data.transferAmountAuditorCiphertextHi),
    }
  } catch {
    return 'malformed'
  }
}

// wasm throws a string when the logarithm is not found — the key is not the auditor's.
function tryDecrypt(run: () => bigint): bigint | undefined {
  try {
    return run()
  } catch {
    return undefined
  }
}

// The key is parsed per call and never kept: it exists only as long as the argument does.
export function decryptAsAuditor(auditorSecret: string, wire: string): AuditResult {
  const auditor = parseAuditorKey(auditorSecret)
  if (!auditor) return fail('invalid-key')
  const ciphertext = readAuditorCiphertext(wire)
  if (typeof ciphertext === 'string') return fail(ciphertext)
  const lo = ElGamalCiphertext.fromBytes(ciphertext.lo)
  const hi = ElGamalCiphertext.fromBytes(ciphertext.hi)
  if (!lo || !hi) return fail('malformed')
  const secret = auditor.secret()
  const partLo = tryDecrypt(() => secret.decrypt(lo))
  if (partLo === undefined) return fail('wrong-key')
  const partHi = tryDecrypt(() => secret.decrypt(hi))
  if (partHi === undefined) return fail('wrong-key')
  return { ok: true, units: partLo + (partHi << LO_BITS) }
}
