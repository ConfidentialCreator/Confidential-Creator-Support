import {
  type AccountMeta,
  AccountRole,
  type Address,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Instruction,
  type InstructionWithAccounts,
  type InstructionWithData,
  type ReadonlyUint8Array,
  type Transaction,
} from '@solana/kit'
import {
  identifyRecordInstruction,
  RECORD_PROGRAM_ADDRESS,
  RecordInstruction,
} from '@solana-program/record'
import {
  identifySystemInstruction,
  parseCreateAccountInstruction,
  SYSTEM_PROGRAM_ADDRESS,
  SystemInstruction,
} from '@solana-program/system'
import {
  ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  ZkElGamalProofInstruction,
} from '@solana-program/zk-elgamal-proof'

export type RelayMode = 'proofs' | 'close'

export type RelayValidation = { ok: true; transaction: Transaction } | { ok: false; reason: string }

export const RELAY_MAX_TRANSACTION_BYTES = 1232
// A record holding a BatchedRangeProofU128: 33-byte header + 1000 bytes of proof —
// the largest account the SDK transfer plan creates.
export const MAX_CREATE_ACCOUNT_SPACE = 1033
// Rent for that record with headroom; the payer gets it back on close.
export const MAX_CREATE_ACCOUNT_LAMPORTS = 10_000_000n

const CONTEXT_OWNERS: readonly Address[] = [
  ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  RECORD_PROGRAM_ADDRESS,
]

type ResolvedInstruction = Instruction &
  InstructionWithAccounts<AccountMeta[]> &
  InstructionWithData<ReadonlyUint8Array>

const reject = (reason: string): RelayValidation => ({ ok: false, reason })

function decodeWire(wire: string): { bytes: Uint8Array } | { reason: string } {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(getBase64Encoder().encode(wire))
  } catch {
    return { reason: 'transaction is not base64' }
  }
  if (bytes.length > RELAY_MAX_TRANSACTION_BYTES) {
    return {
      reason: `transaction is ${bytes.length} bytes, limit is ${RELAY_MAX_TRANSACTION_BYTES}`,
    }
  }
  return { bytes }
}

function checkCreateAccount(ix: ResolvedInstruction): string | null {
  const parsed = parseCreateAccountInstruction(ix)
  const { programAddress: owner, lamports, space } = parsed.data
  if (!CONTEXT_OWNERS.includes(owner)) return `CreateAccount owner ${owner} is not allowed`
  if (space > MAX_CREATE_ACCOUNT_SPACE) {
    return `CreateAccount space ${space} exceeds ${MAX_CREATE_ACCOUNT_SPACE}`
  }
  if (lamports > MAX_CREATE_ACCOUNT_LAMPORTS) {
    return `CreateAccount lamports ${lamports} exceeds ${MAX_CREATE_ACCOUNT_LAMPORTS}`
  }
  return null
}

function checkProofInstruction(ix: ResolvedInstruction, payer: Address): string | null {
  const accounts = ix.accounts
  switch (ix.programAddress) {
    case SYSTEM_PROGRAM_ADDRESS: {
      const kind = identifySystemInstruction(ix)
      if (kind !== SystemInstruction.CreateAccount) {
        return `System ${SystemInstruction[kind]} is not allowed`
      }
      return checkCreateAccount(ix)
    }
    case ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS: {
      const kind = ix.data[0]
      if (kind === undefined || !(kind in ZkElGamalProofInstruction)) {
        return 'unknown ZkElGamalProof instruction'
      }
      if (kind === ZkElGamalProofInstruction.CloseContextState) {
        return 'ZkElGamalProof CloseContextState is not allowed while proving'
      }
      // The context-state authority is the only key that can close the account
      // and reclaim its rent, so it has to be the payer.
      const authority = accounts.at(-1)
      if (accounts.length < 2 || authority?.address !== payer) {
        return 'proof context authority must be the payer'
      }
      return null
    }
    case RECORD_PROGRAM_ADDRESS: {
      const kind = identifyRecordInstruction(ix)
      if (kind !== RecordInstruction.Initialize && kind !== RecordInstruction.Write) {
        return `Record ${RecordInstruction[kind]} is not allowed while proving`
      }
      return null
    }
    default:
      return `program ${ix.programAddress} is not allowed`
  }
}

function checkCloseInstruction(ix: ResolvedInstruction, payer: Address): string | null {
  const accounts = ix.accounts
  switch (ix.programAddress) {
    case ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS: {
      if (ix.data[0] !== ZkElGamalProofInstruction.CloseContextState) {
        return 'only ZkElGamalProof CloseContextState is allowed when closing'
      }
      if (accounts[1]?.address !== payer) return 'CloseContextState destination must be the payer'
      return null
    }
    case RECORD_PROGRAM_ADDRESS: {
      if (identifyRecordInstruction(ix) !== RecordInstruction.CloseAccount) {
        return 'only Record CloseAccount is allowed when closing'
      }
      if (accounts[2]?.address !== payer) return 'Record CloseAccount receiver must be the payer'
      return null
    }
    default:
      return `program ${ix.programAddress} is not allowed when closing`
  }
}

type Decoded = { transaction: Transaction; instructions: ResolvedInstruction[]; signers: string[] }

// Instructions are re-materialised with addresses so the program parsers can read
// them; roles are irrelevant to the checks and left as read-only.
function decodeTransaction(bytes: Uint8Array): Decoded | { reason: string } {
  let transaction: Transaction
  let message: ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>['decode']>
  try {
    transaction = getTransactionDecoder().decode(bytes)
    message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
  } catch {
    return { reason: 'transaction does not decode' }
  }
  if (!('instructions' in message) || message.instructions.length === 0) {
    return { reason: 'transaction has no instructions' }
  }
  if (message.version !== 'legacy' && (message.addressTableLookups?.length ?? 0) > 0) {
    return { reason: 'address lookup tables are not allowed' }
  }
  const keys = message.staticAccounts
  const instructions: ResolvedInstruction[] = []
  for (const [index, compiled] of message.instructions.entries()) {
    const programAddress = keys[compiled.programAddressIndex]
    const accounts = (compiled.accountIndices ?? []).map((i) => keys[i])
    if (!programAddress || !accounts.every((a) => a !== undefined)) {
      return { reason: `instruction ${index}: account index out of range` }
    }
    instructions.push({
      programAddress,
      accounts: accounts.map((address) => ({ address, role: AccountRole.READONLY })),
      data: compiled.data ?? new Uint8Array(),
    })
  }
  return { transaction, instructions, signers: keys.slice(0, message.header.numSignerAccounts) }
}

export function validateRelayTransaction(
  wire: string,
  payer: Address,
  mode: RelayMode,
): RelayValidation {
  const wireBytes = decodeWire(wire)
  if ('reason' in wireBytes) return reject(wireBytes.reason)
  const decoded = decodeTransaction(wireBytes.bytes)
  if ('reason' in decoded) return reject(decoded.reason)

  const { transaction, instructions, signers } = decoded
  if (signers[0] !== payer) return reject(`fee payer ${signers[0]} is not the relay payer`)
  const unsigned = signers.find((a) => a !== payer && transaction.signatures[a as Address] === null)
  if (unsigned) return reject(`missing signature of ${unsigned}`)

  const check = mode === 'proofs' ? checkProofInstruction : checkCloseInstruction
  for (const [index, ix] of instructions.entries()) {
    const reason = check(ix, payer)
    if (reason) return reject(`instruction ${index}: ${reason}`)
  }
  return { ok: true, transaction }
}
