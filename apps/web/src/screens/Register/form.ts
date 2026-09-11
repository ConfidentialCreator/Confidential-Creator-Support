import { HANDLE_PATTERN } from '@ccsupport/shared'

// The program measures `name.len()` and `description.len()` — bytes, not characters
// (`programs/ccsupport/src/state/creator.rs`).
export const NAME_MAX_BYTES = 64
export const DESCRIPTION_MAX_BYTES = 256
const U64_MAX = (1n << 64n) - 1n

export type ProfileInput = { handle: string; name: string; description: string }

export type ProfileCheck =
  | { ok: true; value: ProfileInput }
  | { ok: false; field: keyof ProfileInput; message: string }

const bytes = (s: string) => new TextEncoder().encode(s).length

export function validateProfile(input: ProfileInput): ProfileCheck {
  const value = {
    handle: input.handle.trim(),
    name: input.name.trim(),
    description: input.description.trim(),
  }
  if (!HANDLE_PATTERN.test(value.handle)) {
    return {
      ok: false,
      field: 'handle',
      message: 'lowercase letters, digits and dashes, 3 to 32 of them',
    }
  }
  if (value.name === '' || bytes(value.name) > NAME_MAX_BYTES) {
    return { ok: false, field: 'name', message: `1 to ${NAME_MAX_BYTES} bytes` }
  }
  if (value.description === '' || bytes(value.description) > DESCRIPTION_MAX_BYTES) {
    return { ok: false, field: 'description', message: `1 to ${DESCRIPTION_MAX_BYTES} bytes` }
  }
  return { ok: true, value }
}

export function parseUnits(input: string, decimals: number): bigint | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(input.trim())
  if (!match || match[1] === undefined) return null
  const fraction = match[2] ?? ''
  if (fraction.length > decimals) return null
  const units = BigInt(match[1] + fraction.padEnd(decimals, '0'))
  return units > U64_MAX ? null : units
}

// `Creator.handle` on chain is 32 bytes, zero-padded.
export function handleFromBytes(bytes: Iterable<number>): string {
  return new TextDecoder().decode(Uint8Array.from(bytes)).replace(/\0+$/, '')
}
