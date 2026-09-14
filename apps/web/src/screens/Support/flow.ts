import type { ConfidentialAccountState, PreparationStep } from '@ccsupport/chain'
import type { SolanaChain } from '../../config.ts'
import { TOKEN } from '../../mockData.ts'
import { formatUnits } from '../CreatorPage/format.ts'

export type Stage = 'plan' | 'prepare' | 'proofs' | 'transfer' | 'confirm' | 'close'

export const STAGE_TEXT: Record<Stage, string> = {
  plan: 'reading your token account',
  prepare: 'preparing your account — sign in the wallet',
  proofs: 'building the proofs; the platform is placing them on chain',
  transfer: 'transfer and record — sign in the wallet',
  confirm: 'waiting for the network',
  close: 'recorded; the platform is closing the proof accounts',
}

// The sealed part of a configured account is unknown until the keys exist.
export function publicShortfall(units: bigint, state: ConfidentialAccountState): bigint | null {
  switch (state.kind) {
    case 'missing':
      return units
    case 'unconfigured':
      return units > state.publicBalance ? units - state.publicBalance : 0n
    case 'configured':
      return null
  }
}

export type Expectation = { keysDerived: boolean; preparation: boolean }

export function expectedSignatures({ keysDerived, preparation }: Expectation): number {
  return (keysDerived ? 0 : 1) + (preparation ? 1 : 0) + 1
}

const STEP_TEXT: Record<PreparationStep['kind'], string> = {
  configure: 'configure it for sealed transfers',
  deposit: 'move your public balance into it',
  apply: 'apply the balance',
}

type Steps = { keysDerived: boolean; preparation: readonly PreparationStep['kind'][] | null }

export function stepLabels({ keysDerived, preparation }: Steps): string[] {
  const labels: string[] = []
  if (!keysDerived) labels.push('Sign a message to derive your keys · no fee')
  if (preparation === null) {
    labels.push('Prepare your account if needed — one transaction')
  } else if (preparation.length > 0) {
    labels.push(
      `Prepare your account: ${preparation.map((k) => STEP_TEXT[k]).join(', ')} — one transaction`,
    )
  }
  labels.push('Transfer and record support — one transaction')
  return labels
}

export function explorerUrl(signature: string, chain: SolanaChain): string {
  const cluster = chain.slice('solana:'.length)
  const query = cluster === 'mainnet' ? '' : `?cluster=${cluster}`
  return `https://explorer.solana.com/tx/${signature}${query}`
}

export type FundsCheck = {
  units: bigint | null
  amountEntered: boolean
  shortfall: bigint | null
  lamports: bigint
  minLamports: bigint
  planProblem: string | null
  decimals: number
}

// Everything that stops the button before the wallet is asked to sign.
export function fundsProblems(check: FundsCheck): string[] {
  const problems: string[] = []
  if (check.units === null && check.amountEntered) {
    problems.push(`A ${TOKEN} figure with up to ${check.decimals} decimals`)
  }
  if (check.shortfall !== null && check.shortfall > 0n) {
    problems.push(
      `Not enough ${TOKEN} in your wallet — ${formatUnits(check.shortfall.toString(), check.decimals)} ${TOKEN} short`,
    )
  }
  if (check.lamports < check.minLamports) {
    problems.push(
      `Not enough SOL for the fees — at least ${formatUnits(check.minLamports.toString(), 9)} SOL is needed`,
    )
  }
  if (check.planProblem !== null) problems.push(check.planProblem)
  return problems
}
