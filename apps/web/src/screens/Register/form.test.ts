import { describe, expect, it } from 'vitest'
import {
  DESCRIPTION_MAX_BYTES,
  handleFromBytes,
  NAME_MAX_BYTES,
  parseUnits,
  validateProfile,
} from './form.ts'

const ok = { handle: 'marrow-dispatch', name: 'Ilse Marrow', description: 'Port cities.' }

describe('validateProfile', () => {
  it('passes a well-formed profile through trimmed', () => {
    expect(validateProfile({ ...ok, name: '  Ilse Marrow ' })).toEqual({ ok: true, value: ok })
  })

  it('names the field that fails', () => {
    expect(validateProfile({ ...ok, handle: 'Marrow' })).toEqual({
      ok: false,
      field: 'handle',
      message: 'lowercase letters, digits and dashes, 3 to 32 of them',
    })
    expect(validateProfile({ ...ok, name: '' })).toMatchObject({ ok: false, field: 'name' })
    expect(validateProfile({ ...ok, description: '' })).toMatchObject({
      ok: false,
      field: 'description',
    })
  })

  it('measures the limits in bytes, as the program does', () => {
    expect(validateProfile({ ...ok, name: 'a'.repeat(NAME_MAX_BYTES) }).ok).toBe(true)
    expect(validateProfile({ ...ok, name: 'a'.repeat(NAME_MAX_BYTES + 1) }).ok).toBe(false)
    // 'ї' is two bytes in UTF-8: 33 of them fit 64 bytes, 33 do not fit 64 when 'a' is added.
    expect(validateProfile({ ...ok, name: 'ї'.repeat(32) }).ok).toBe(true)
    expect(validateProfile({ ...ok, name: `${'ї'.repeat(32)}a` }).ok).toBe(false)
    expect(validateProfile({ ...ok, description: 'b'.repeat(DESCRIPTION_MAX_BYTES) }).ok).toBe(true)
    expect(validateProfile({ ...ok, description: 'b'.repeat(DESCRIPTION_MAX_BYTES + 1) }).ok).toBe(
      false,
    )
  })
})

describe('parseUnits', () => {
  it('turns a decimal figure into base units', () => {
    expect(parseUnits('5', 6)).toBe(5_000_000n)
    expect(parseUnits('5.00', 6)).toBe(5_000_000n)
    expect(parseUnits('0.5', 6)).toBe(500_000n)
    expect(parseUnits(' 12.345678 ', 6)).toBe(12_345_678n)
    expect(parseUnits('0', 6)).toBe(0n)
  })

  it('refuses more decimals than the token has, negatives, and non-numbers', () => {
    expect(parseUnits('1.2345678', 6)).toBeNull()
    expect(parseUnits('-1', 6)).toBeNull()
    expect(parseUnits('', 6)).toBeNull()
    expect(parseUnits('1e3', 6)).toBeNull()
    expect(parseUnits('.', 6)).toBeNull()
  })

  it('refuses a figure that does not fit a u64', () => {
    expect(parseUnits('18446744073709.551615', 6)).toBe(18446744073709551615n)
    expect(parseUnits('18446744073709.551616', 6)).toBeNull()
  })
})

describe('handleFromBytes', () => {
  it('drops the zero padding of the 32-byte field', () => {
    const bytes = new Uint8Array(32)
    bytes.set(new TextEncoder().encode('marrow-dispatch'))
    expect(handleFromBytes(bytes)).toBe('marrow-dispatch')
    expect(handleFromBytes(new Uint8Array(32))).toBe('')
  })
})
