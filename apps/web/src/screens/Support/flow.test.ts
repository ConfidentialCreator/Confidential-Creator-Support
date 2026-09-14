import type { ConfidentialAccountState } from '@ccsupport/chain'
import { address } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import {
  expectedSignatures,
  explorerUrl,
  fundsProblems,
  publicShortfall,
  stepLabels,
} from './flow.ts'

type Configured = Extract<ConfidentialAccountState, { kind: 'configured' }>

const configured: Configured = {
  kind: 'configured',
  publicBalance: 0n,
  approved: true,
  elgamalPubkey: address('6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk'),
  extension: {} as Configured['extension'],
}

describe('publicShortfall', () => {
  it('is the whole amount for a missing token account', () => {
    expect(publicShortfall(7_250_000n, { kind: 'missing' })).toBe(7_250_000n)
  })

  it('counts only the public balance of an unconfigured account', () => {
    expect(publicShortfall(7_250_000n, { kind: 'unconfigured', publicBalance: 5_000_000n })).toBe(
      2_250_000n,
    )
    expect(publicShortfall(7_250_000n, { kind: 'unconfigured', publicBalance: 7_250_000n })).toBe(
      0n,
    )
    expect(publicShortfall(1n, { kind: 'unconfigured', publicBalance: 100n })).toBe(0n)
  })

  it('does not know the sealed part of a configured account', () => {
    expect(publicShortfall(7_250_000n, configured)).toBeNull()
  })
})

describe('expectedSignatures', () => {
  it('is one message plus one transaction for a prepared wallet', () => {
    expect(expectedSignatures({ keysDerived: false, preparation: false })).toBe(2)
  })

  it('drops the message once the keys are derived', () => {
    expect(expectedSignatures({ keysDerived: true, preparation: false })).toBe(1)
  })

  it('adds one transaction for the preparation', () => {
    expect(expectedSignatures({ keysDerived: false, preparation: true })).toBe(3)
    expect(expectedSignatures({ keysDerived: true, preparation: true })).toBe(2)
  })
})

describe('stepLabels', () => {
  it('lists the message, the preparation and the transfer for a first contribution', () => {
    const labels = stepLabels({
      keysDerived: false,
      preparation: ['configure', 'deposit', 'apply'],
    })
    expect(labels).toHaveLength(3)
    expect(labels[0]).toMatch(/sign a message/i)
    expect(labels[1]).toMatch(/prepare/i)
    expect(labels[1]).toMatch(/one transaction/i)
    expect(labels[2]).toMatch(/transfer and record/i)
  })

  it('names only the steps the account still needs', () => {
    const labels = stepLabels({ keysDerived: true, preparation: ['apply'] })
    expect(labels).toHaveLength(2)
    expect(labels[0]).toMatch(/apply/i)
    expect(labels[0]).not.toMatch(/deposit/i)
  })

  it('is the transfer alone for a prepared wallet with derived keys', () => {
    expect(stepLabels({ keysDerived: true, preparation: [] })).toHaveLength(1)
  })

  it('shows the preparation as pending while the plan is unknown', () => {
    const labels = stepLabels({ keysDerived: false, preparation: null })
    expect(labels).toHaveLength(3)
    expect(labels[1]).toMatch(/if needed/i)
  })
})

describe('explorerUrl', () => {
  it('points at the transaction on the configured cluster', () => {
    expect(explorerUrl('5STQAx9', 'solana:devnet')).toBe(
      'https://explorer.solana.com/tx/5STQAx9?cluster=devnet',
    )
  })

  it('omits the cluster query on mainnet', () => {
    expect(explorerUrl('5STQAx9', 'solana:mainnet')).toBe('https://explorer.solana.com/tx/5STQAx9')
  })
})

describe('fundsProblems', () => {
  const fine = {
    units: 7_250_000n,
    amountEntered: true,
    shortfall: 0n,
    lamports: 20_000_000n,
    minLamports: 5_000_000n,
    planProblem: null,
    decimals: 6,
  }

  it('is empty when the amount parses and the wallet covers it', () => {
    expect(fundsProblems(fine)).toEqual([])
    expect(fundsProblems({ ...fine, shortfall: null })).toEqual([])
  })

  it('names the shortfall in token units and the SOL floor', () => {
    const problems = fundsProblems({ ...fine, shortfall: 2_250_000n, lamports: 100n })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/2\.25 SUPD short/)
    expect(problems[1]).toMatch(/0\.005 SOL/)
  })

  it('flags an unparsable amount only once something was typed', () => {
    expect(fundsProblems({ ...fine, units: null, amountEntered: false })).toEqual([])
    expect(fundsProblems({ ...fine, units: null })[0]).toMatch(/up to 6 decimals/)
  })

  it('passes the plan error through', () => {
    expect(fundsProblems({ ...fine, planProblem: 'insufficient funds: 5 more units' })).toEqual([
      'insufficient funds: 5 more units',
    ])
  })
})
