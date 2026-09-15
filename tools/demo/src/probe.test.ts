import {
  type Address,
  generateKeyPairSigner,
  type Signature,
  type SignatureDictionary,
} from '@solana/kit'
import { describe, expect, it } from 'vitest'
import {
  awaitIndexed,
  countingSigner,
  measureSchema,
  type Probe,
  summarizeMeasure,
} from './probe.ts'
import type { DemoRun } from './scenarios/us1.ts'

describe('countingSigner', () => {
  it('counts each signing call once and keeps the address and key pair', async () => {
    const inner = await generateKeyPairSigner()
    const counted = countingSigner(inner)
    expect(counted.signer.address).toBe(inner.address)
    expect(counted.signer.keyPair).toBe(inner.keyPair)
    expect(counted.counts).toEqual({ transactions: 0, messages: 0 })

    await counted.signer.signMessages([{ content: new Uint8Array([1]), signatures: {} }])
    await counted.signer.signMessages([{ content: new Uint8Array([2]), signatures: {} }])
    expect(counted.counts).toEqual({ transactions: 0, messages: 2 })
  })

  it('counts a batch of transactions as one wallet confirmation', async () => {
    const inner = await generateKeyPairSigner()
    const signed: SignatureDictionary[] = []
    const stub = {
      ...inner,
      signTransactions: async () => signed,
    }
    const counted = countingSigner(stub)
    // the stub never reads its argument, so an empty batch is enough
    await counted.signer.signTransactions([])
    expect(counted.counts).toEqual({ transactions: 1, messages: 0 })
  })
})

describe('awaitIndexed', () => {
  function clock() {
    let at = 0
    return {
      now: () => at,
      sleep: async (ms: number) => {
        at += ms
      },
    }
  }

  it('returns the wait until the reader first reports true', async () => {
    const c = clock()
    let polls = 0
    const seen = await awaitIndexed(async () => ++polls >= 3, {
      intervalMs: 1_000,
      timeoutMs: 30_000,
      ...c,
    })
    expect(seen).toEqual({ ms: 2_000, polls: 3 })
  })

  it('reports zero when the index is already there', async () => {
    const seen = await awaitIndexed(async () => true, {
      intervalMs: 1_000,
      timeoutMs: 30_000,
      ...clock(),
    })
    expect(seen).toEqual({ ms: 0, polls: 1 })
  })

  it('gives up after the timeout', async () => {
    const c = clock()
    let polls = 0
    const seen = await awaitIndexed(
      async () => {
        polls += 1
        return false
      },
      { intervalMs: 1_000, timeoutMs: 3_000, ...c },
    )
    expect(seen).toBeNull()
    expect(polls).toBe(4)
  })
})

const run = {
  summary: {
    sc003: { firstP95Ms: 38_000, repeatP95Ms: 33_000 },
    sc008: { totalMs: 1_200_000, pass: true },
  },
} as DemoRun

function probe(overrides: Partial<Probe> = {}): Probe {
  return {
    index: 0,
    wallet: '11111111111111111111111111111111' as Address,
    token: '11111111111111111111111111111111' as Address,
    faucetSignature: 'f' as Signature,
    preparationSignatures: ['p' as Signature],
    contributions: [
      {
        kind: 'first',
        periods: 1,
        proofSignatures: ['a', 'b', 'c', 'd'] as Signature[],
        transferSignature: 't1' as Signature,
        closeSignatures: ['x' as Signature],
        confirmedMs: 20_000,
        totalMs: 25_000,
        amountTraces: [],
        decryptedMatches: true,
        signatures: { transactions: 2, messages: 1 },
        counter: { before: 409, after: 410, ms: 8_000, polls: 9 },
        indexed: { ms: 8_000, polls: 9 },
      },
      {
        kind: 'repeat',
        periods: 2,
        proofSignatures: ['e', 'f', 'g', 'h'] as Signature[],
        transferSignature: 't2' as Signature,
        closeSignatures: ['y' as Signature],
        confirmedMs: 15_000,
        totalMs: 18_000,
        amountTraces: [],
        decryptedMatches: true,
        signatures: { transactions: 1, messages: 0 },
        counter: null,
        indexed: { ms: 3_000, polls: 4 },
      },
    ],
    error: null,
    ...overrides,
  }
}

describe('summarizeMeasure', () => {
  it('passes when every counter moved within budget and signatures stay under the caps', () => {
    const summary = summarizeMeasure([probe(), probe({ index: 1 })], run)
    expect(summary.sc002).toEqual({ samples: 2, maxMs: 8_000, pass: true })
    expect(summary.sc003.first).toEqual({
      samples: 2,
      p95Ms: 20_000,
      maxMs: 20_000,
      signaturesMax: 3,
    })
    expect(summary.sc003.repeat).toEqual({
      samples: 2,
      p95Ms: 15_000,
      maxMs: 15_000,
      signaturesMax: 1,
    })
    expect(summary.sc003.pass).toBe(true)
    expect(summary.sc003.cliP95Ms).toEqual({ first: 38_000, repeat: 33_000 })
    expect(summary.sc008).toEqual({ totalMs: 1_200_000, pass: true })
    expect(summary.sc001).toEqual({ checked: 4, clean: 4, pass: true })
    expect(summary.failed).toBe(0)
  })

  it('fails SC-002 when a counter never moved', () => {
    const stuck = probe()
    const first = stuck.contributions[0]
    if (first) first.counter = null
    const summary = summarizeMeasure([stuck], run)
    expect(summary.sc002).toEqual({ samples: 0, maxMs: 0, pass: false })
  })

  it('fails SC-003 on a third confirmation for a repeat', () => {
    const chatty = probe()
    const repeat = chatty.contributions[1]
    if (repeat) repeat.signatures = { transactions: 3, messages: 0 }
    const summary = summarizeMeasure([chatty], run)
    expect(summary.sc003.repeat.signaturesMax).toBe(3)
    expect(summary.sc003.pass).toBe(false)
  })

  it('counts a failed probe and excludes it from the samples', () => {
    const summary = summarizeMeasure(
      [probe(), probe({ index: 1, contributions: [], error: 'faucet: RATE_LIMITED' })],
      run,
    )
    expect(summary.failed).toBe(1)
    expect(summary.sc002.samples).toBe(1)
    expect(summary.sc002.pass).toBe(false)
  })

  it('serialises without any amount field', () => {
    const summary = summarizeMeasure([probe()], run)
    const parsed = measureSchema.parse({
      cluster: 'devnet',
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
      api: 'http://127.0.0.1:8787',
      handle: 'marrow-dispatch',
      probes: [probe()],
      summary,
    })
    expect(JSON.stringify(parsed)).not.toMatch(/"(amount|units)"/i)
  })
})
