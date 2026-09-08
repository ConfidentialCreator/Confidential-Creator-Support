import { readFileSync } from 'node:fs'
import { getBase64Encoder } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { txFixtureSchema } from '../spike/fixture.ts'
import { findAmountTraces, u64Le, uiAmount } from './no-amount.ts'

const FIXTURES = new URL('../../../../fixtures/tx/', import.meta.url)

function loadFixture(name: string) {
  return txFixtureSchema.parse(JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8')))
}

const wireBytes = (wire: string) => new Uint8Array(getBase64Encoder().encode(wire))

const transfer = loadFixture('transfer')
const deposit = loadFixture('deposit')
const TRANSFER_UNITS = BigInt(transfer.context.amount)
const DEPOSIT_UNITS = 25_000_000n

describe('u64Le', () => {
  it('encodes little-endian over eight bytes', () => {
    expect([...u64Le(7_250_000n)]).toEqual([0x50, 0xa0, 0x6e, 0, 0, 0, 0, 0])
  })
})

describe('uiAmount', () => {
  it('drops trailing zeros and the point for whole amounts', () => {
    expect(uiAmount(7_250_000n, 6)).toBe('7.25')
    expect(uiAmount(5_000_000n, 6)).toBe('5')
    expect(uiAmount(1_234n, 6)).toBe('0.001234')
  })
})

describe('findAmountTraces', () => {
  it('finds nothing in the confidential transfer, its logs and both token accounts', () => {
    const traces = findAmountTraces({
      units: TRANSFER_UNITS,
      decimals: transfer.context.decimals,
      logs: transfer.logMessages,
      transaction: wireBytes(transfer.wire),
      accounts: [
        { label: 'source', data: wireBytes(transfer.wire).slice(100, 300) },
        { label: 'destination', data: new Uint8Array(200) },
      ],
    })
    expect(traces).toEqual([])
  })

  it('finds the plaintext u64 of a Deposit inside the transaction bytes', () => {
    const traces = findAmountTraces({
      units: DEPOSIT_UNITS,
      decimals: deposit.context.decimals,
      logs: deposit.logMessages,
      transaction: wireBytes(deposit.wire),
      accounts: [],
    })
    expect(traces).toEqual([{ source: 'transaction', where: 'wire', form: 'u64le' }])
  })

  it('finds the amount written as a decimal or a ui string in the logs', () => {
    const traces = findAmountTraces({
      units: TRANSFER_UNITS,
      decimals: 6,
      logs: [
        'Program log: Instruction: Transfer',
        'Program log: amount 7250000',
        'Program log: sent 7.25 SUPD',
      ],
      transaction: new Uint8Array(0),
      accounts: [],
    })
    expect(traces).toEqual([
      { source: 'logs', where: 'line 2', form: 'decimal' },
      { source: 'logs', where: 'line 3', form: 'ui' },
    ])
  })

  it('finds the u64 and the decimal ascii inside account data', () => {
    const data = new Uint8Array(64)
    data.set(u64Le(TRANSFER_UNITS), 16)
    const ascii = new TextEncoder().encode(TRANSFER_UNITS.toString())
    const traces = findAmountTraces({
      units: TRANSFER_UNITS,
      decimals: 6,
      logs: [],
      transaction: new Uint8Array(0),
      accounts: [
        { label: 'destination', data },
        { label: 'memo', data: ascii },
      ],
    })
    expect(traces).toEqual([
      { source: 'account', where: 'destination', form: 'u64le' },
      { source: 'account', where: 'memo', form: 'decimal' },
    ])
  })

  it('matches digits only as whole numbers, not inside a longer one', () => {
    const traces = findAmountTraces({
      units: 5_000_000n,
      decimals: 6,
      logs: ['Program consumed 5000 of 200000 compute units', 'balance 15000000'],
      transaction: new Uint8Array(0),
      accounts: [],
    })
    expect(traces).toEqual([])
  })
})
