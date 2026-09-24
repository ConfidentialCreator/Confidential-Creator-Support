import { readFileSync } from 'node:fs'
import { GRACE_SECONDS, MAX_PERIODS, PERIOD_SECONDS } from '@ccsupport/shared'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

const fixture = JSON.parse(read('../../../fixtures/periods.json')) as {
  periodSeconds: number
  graceSeconds: number
  maxPeriods: number
}

const migration = read('../migrations/0002_active.sql')
const program = read('../../../programs/ccsupport/src/periods.rs')

const product = (expression: string): number =>
  expression.split('*').reduce((acc, factor) => acc * Number(factor.trim()), 1)

// The program already checks itself against the fixture in `periods.rs`; reading the
// constants here too makes `pnpm gate` fail on a drift without a cargo run in WSL.
const programConstant = (name: string): number => {
  const declared = program.match(new RegExp(`const ${name}: [a-z0-9]+ = ([^;]+);`))?.[1]
  if (!declared) throw new Error(`${name} is not declared in programs/ccsupport/src/periods.rs`)
  return product(declared)
}

const graceLiterals = [...migration.matchAll(/interval '(\d+) seconds'/g)].map((m) => Number(m[1]))

describe('period constants', () => {
  it('holds the SQL grace window in one place, on the fixture', () => {
    expect(graceLiterals).toEqual([fixture.graceSeconds])
    expect(migration).toContain('ccs_is_active(expires_at timestamptz, at_time timestamptz)')
  })

  it('holds the shared constants on the fixture', () => {
    expect({
      periodSeconds: PERIOD_SECONDS,
      graceSeconds: GRACE_SECONDS,
      maxPeriods: MAX_PERIODS,
    }).toEqual(fixture)
  })

  it('holds the program constants on the fixture', () => {
    expect({
      periodSeconds: programConstant('PERIOD_SECONDS'),
      graceSeconds: programConstant('GRACE_SECONDS'),
      maxPeriods: programConstant('MAX_PERIODS'),
    }).toEqual(fixture)
  })

  it('fails loudly when a program constant is renamed away', () => {
    expect(() => programConstant('PERIOD_DAYS')).toThrow(/not declared/)
  })
})
