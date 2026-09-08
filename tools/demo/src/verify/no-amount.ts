// SC-001: стороння перевірка внеску не дає суми. Шукаємо суму у трьох формах —
// u64 LE (так її несе інструкція `Deposit` і поле балансу звичайного токена),
// десяткове число і рядок з крапкою (так її показав би оглядач) — у байтах
// транзакції, у логах і в даних обох ATA.
import {
  type Address,
  type GetMultipleAccountsApi,
  type GetTransactionApi,
  getBase64Encoder,
  type Rpc,
  type Signature,
} from '@solana/kit'

export type AmountTraceSource = 'transaction' | 'logs' | 'account'
export type AmountTraceForm = 'u64le' | 'decimal' | 'ui'
export type AmountTrace = { source: AmountTraceSource; where: string; form: AmountTraceForm }

export type AmountTraceInput = {
  units: bigint
  decimals: number
  logs: readonly string[]
  transaction: Uint8Array
  accounts: readonly { label: string; data: Uint8Array }[]
}

export function u64Le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, value, true)
  return bytes
}

export function uiAmount(units: bigint, decimals: number): string {
  const text = units.toString().padStart(decimals + 1, '0')
  const whole = text.slice(0, text.length - decimals)
  const fraction = text.slice(text.length - decimals).replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wholeNumber = (text: string) => new RegExp(`(?<![\\d.])${escapeRegex(text)}(?![\\d.])`)

export function findAmountTraces(input: AmountTraceInput): AmountTrace[] {
  const traces: AmountTrace[] = []
  const le = u64Le(input.units)
  const decimal = input.units.toString()
  const ascii = new TextEncoder().encode(decimal)
  const ui = uiAmount(input.units, input.decimals)
  const decimalRe = wholeNumber(decimal)
  // Ціла сума без дробової частини вже покрита формою `decimal`.
  const uiRe = ui.includes('.') ? wholeNumber(ui) : null

  if (containsBytes(input.transaction, le)) {
    traces.push({ source: 'transaction', where: 'wire', form: 'u64le' })
  }
  if (containsBytes(input.transaction, ascii)) {
    traces.push({ source: 'transaction', where: 'wire', form: 'decimal' })
  }
  input.logs.forEach((line, i) => {
    if (decimalRe.test(line))
      traces.push({ source: 'logs', where: `line ${i + 1}`, form: 'decimal' })
    if (uiRe?.test(line)) traces.push({ source: 'logs', where: `line ${i + 1}`, form: 'ui' })
  })
  for (const { label, data } of input.accounts) {
    if (containsBytes(data, le)) traces.push({ source: 'account', where: label, form: 'u64le' })
    if (containsBytes(data, ascii))
      traces.push({ source: 'account', where: label, form: 'decimal' })
  }
  return traces
}

export type NoAmountCheck = {
  signature: Signature
  units: bigint
  decimals: number
  tokens: readonly { label: string; address: Address }[]
}

export type NoAmountResult = { traces: AmountTrace[]; wire: string; logs: string[] }

export async function verifyNoAmount(
  rpc: Rpc<GetTransactionApi & GetMultipleAccountsApi>,
  check: NoAmountCheck,
): Promise<NoAmountResult> {
  const [tx, accounts] = await Promise.all([
    rpc
      .getTransaction(check.signature, {
        encoding: 'base64',
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      })
      .send(),
    check.tokens.length === 0
      ? { value: [] }
      : rpc
          .getMultipleAccounts(
            check.tokens.map((t) => t.address),
            { encoding: 'base64', commitment: 'confirmed' },
          )
          .send(),
  ])
  if (!tx) throw new Error(`transaction ${check.signature} not found`)
  const base64 = getBase64Encoder()
  const wire = tx.transaction[0]
  const logs = [...(tx.meta?.logMessages ?? [])]
  const traces = findAmountTraces({
    units: check.units,
    decimals: check.decimals,
    logs,
    transaction: new Uint8Array(base64.encode(wire)),
    accounts: check.tokens.map((token, i) => {
      const account = accounts.value[i]
      if (!account) throw new Error(`token account ${token.address} not found`)
      return { label: token.label, data: new Uint8Array(base64.encode(account.data[0])) }
    }),
  })
  return { traces, wire, logs }
}
