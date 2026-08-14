import { TOKEN } from '../../mockData.ts'

export type Mode = 'first' | 'returning'

export function parseAmount(input: string): number | null {
  const n = Number(input)
  return input.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

export function isInsufficient(input: string, balance: number): boolean {
  const n = parseAmount(input)
  return n !== null && n > balance
}

export function steps(mode: Mode, input: string): string[] {
  const n = parseAmount(input)
  const shown = n === null ? input : n.toFixed(2)
  if (mode === 'returning') {
    return [
      'Sign a message to derive your keys · no fee',
      'Transfer and record support — one transaction',
    ]
  }
  return [
    'Sign a message to derive your keys · no fee',
    'Prepare your account for sealed transfers',
    `Move ${shown} ${TOKEN} into your sealed balance`,
    'Apply the balance',
    'Transfer and record support — one transaction',
  ]
}

export function confirmations(mode: Mode): string {
  return mode === 'first'
    ? '5 confirmations · about 3 minutes · the platform pays for the proofs, you pay only for what you sign'
    : '2 confirmations · under a minute'
}
