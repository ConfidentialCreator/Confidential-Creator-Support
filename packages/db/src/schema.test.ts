import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { contributions, creators, indexerState, pledges } from './schema.ts'

const U64_COLUMNS = [
  creators.suggestedAmount,
  creators.createdSlot,
  pledges.lastSlot,
  contributions.slot,
  indexerState.lastSlot,
]

describe('u64 columns', () => {
  it.each(U64_COLUMNS.map((c) => [c.name, c]))('%s is numeric(20,0), never bigint', (_, column) => {
    expect(column.getSQLType()).toBe('numeric(20, 0)')
  })
})

describe('creators', () => {
  it('is keyed by wallet with a unique handle', () => {
    expect(creators.wallet.primary).toBe(true)
    expect(creators.handle.isUnique).toBe(true)
    expect(creators.handle.notNull).toBe(true)
  })

  it('has no column that is not a public profile field', () => {
    const names = getTableConfig(creators).columns.map((c) => c.name)
    expect(names).toEqual([
      'wallet',
      'handle',
      'name',
      'description',
      'suggested_amount',
      'created_slot',
      'indexed_at',
    ])
  })
})

describe('pledges', () => {
  it('is keyed by (creator, supporter) and points at creators', () => {
    const config = getTableConfig(pledges)
    expect(config.primaryKeys.map((pk) => pk.columns.map((c) => c.name))).toEqual([
      ['creator', 'supporter'],
    ])
    const fks = config.foreignKeys.map((fk) => fk.reference())
    expect(fks).toHaveLength(1)
    expect(fks[0]?.foreignTable).toBe(creators)
    expect(fks[0]?.columns.map((c) => c.name)).toEqual(['creator'])
  })

  it('stores chain time as timestamptz, everything not null', () => {
    expect(pledges.startedAt.getSQLType()).toBe('timestamp with time zone')
    expect(pledges.expiresAt.getSQLType()).toBe('timestamp with time zone')
    for (const column of getTableConfig(pledges).columns)
      expect(column.notNull, column.name).toBe(true)
  })

  it('indexes the active-supporter question: creator + expires_at', () => {
    const indexes = getTableConfig(pledges).indexes.map((i) =>
      i.config.columns.map((c) => ('name' in c ? c.name : '')),
    )
    expect(indexes).toContainEqual(['creator', 'expires_at'])
  })
})

describe('contributions', () => {
  it('is keyed by the transfer signature and belongs to a pledge', () => {
    const config = getTableConfig(contributions)
    expect(contributions.sig.primary).toBe(true)
    const fks = config.foreignKeys.map((fk) => fk.reference())
    expect(fks).toHaveLength(1)
    expect(fks[0]?.foreignTable).toBe(pledges)
    expect(fks[0]?.columns.map((c) => c.name)).toEqual(['creator', 'supporter'])
  })

  it('keeps the recipient ciphertext as two 128-byte bytea and the proof signature, all required', () => {
    expect(contributions.groupedLo.getSQLType()).toBe('bytea')
    expect(contributions.groupedHi.getSQLType()).toBe('bytea')
    expect(contributions.groupedLo.notNull).toBe(true)
    expect(contributions.groupedHi.notNull).toBe(true)
    expect(contributions.proofSig.notNull).toBe(true)
    const checks = getTableConfig(contributions).checks.map((c) => c.name)
    expect(checks).toEqual(
      expect.arrayContaining(['contributions_grouped_lo_len', 'contributions_grouped_hi_len']),
    )
  })

  it('kind is a closed first|renewal enum', () => {
    expect(contributions.kind.getSQLType()).toBe('contribution_kind')
    expect(contributions.kind.enumValues).toEqual(['first', 'renewal'])
  })

  it('indexes creator and supporter listings by slot', () => {
    const indexes = getTableConfig(contributions).indexes.map((i) =>
      i.config.columns.map((c) => ('name' in c ? c.name : '')),
    )
    expect(indexes).toContainEqual(['creator', 'slot'])
    expect(indexes).toContainEqual(['supporter', 'slot'])
  })
})

describe('bytea', () => {
  const column = contributions.groupedLo
  // Column mappers are typed `unknown` on the drizzle side.
  const asBytes = (value: unknown): Uint8Array => {
    if (!(value instanceof Uint8Array)) throw new TypeError('not bytes')
    return value
  }

  it('round-trips bytes through the driver unchanged', () => {
    const bytes = Uint8Array.from({ length: 128 }, (_, i) => (i * 7) & 0xff)
    const driver = column.mapToDriverValue(bytes)
    expect(Buffer.isBuffer(driver)).toBe(true)
    const back = asBytes(column.mapFromDriverValue(driver))
    expect(Array.from(back)).toEqual(Array.from(bytes))
  })

  it('does not alias the driver buffer — a pooled Buffer must not leak into the row', () => {
    const buffer = Buffer.from([1, 2, 3])
    const back = asBytes(column.mapFromDriverValue(buffer))
    buffer[0] = 9
    expect(back[0]).toBe(1)
  })

  it('rejects a non-buffer driver value instead of returning garbage', () => {
    expect(() => column.mapFromDriverValue('\\x0102' as never)).toThrow()
  })
})
