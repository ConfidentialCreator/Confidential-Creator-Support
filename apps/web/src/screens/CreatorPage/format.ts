// The demo mint is created with 6 decimals (`tools/mint`); the browser reads it from
// the chain only once it needs the token account itself.
export const TOKEN_DECIMALS = 6

// String arithmetic: a u64 does not fit a number and the figure must not round.
export function formatUnits(units: string, decimals: number): string {
  if (decimals === 0) return units
  const padded = units.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '').padEnd(2, '0')
  return `${whole}.${fraction}`
}

export const formatDay = (iso: string): string => iso.slice(0, 10)

export const formatUtc = (at: Date): string =>
  `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`
