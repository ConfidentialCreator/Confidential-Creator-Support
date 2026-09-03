import { readFileSync } from 'node:fs'
import { apiErrorBodySchema, relaySignaturesSchema } from '@ccsupport/shared'
import { address, getSignatureFromTransaction, type Signature, type Transaction } from '@solana/kit'
import { Hono } from 'hono'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { requestLogger } from '../logger.ts'
import { errorHandler } from '../middleware/errors.ts'
import type { SubmitResult } from '../relay/payer.ts'
import { relayRoute } from './relay.ts'

const FIXTURE_DIR = new URL('../../../../fixtures/tx/', import.meta.url)
const fixtureSchema = z.object({ wire: z.string() })
const wire = (name: string) =>
  fixtureSchema.parse(JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_DIR), 'utf8'))).wire

// Fee payer of the T006 spike transactions; `submit` is faked, so no secret is needed.
const SPIKE_PAYER = address('D4TkDq52FCqPyvwgQWBDepBumsYKB5ZjroRLfGckrYnQ')

type Outcome = SubmitResult | ((signature: Signature) => SubmitResult)

function build(outcomes: Outcome[] = []) {
  const events: string[] = []
  let call = 0
  const submit = async (transaction: Transaction): Promise<SubmitResult> => {
    const index = call++
    const signature = getSignatureFromTransaction(transaction)
    events.push(`start ${index}`)
    await new Promise((resolve) => setTimeout(resolve, 1))
    events.push(`end ${index}`)
    const outcome = outcomes[index] ?? { ok: true, signature }
    return typeof outcome === 'function' ? outcome(signature) : outcome
  }
  const app = new Hono<AppEnv>()
    .use('*', requestLogger(pino({ level: 'silent' })))
    .onError(errorHandler)
    .route('/', relayRoute({ payer: { address: SPIKE_PAYER, submit } }))
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  return { post, events }
}

const PROOFS = ['proof-1', 'proof-2', 'proof-3', 'proof-4'].map(wire)

async function errorOf(res: Response) {
  return apiErrorBodySchema.parse(await res.json()).error
}

describe('POST /relay/proofs', () => {
  it('signs, sends and confirms the proof transactions one after another', async () => {
    const { post, events } = build()
    const res = await post('/relay/proofs', { transactions: PROOFS })
    expect(res.status).toBe(200)
    const { signatures } = z.object({ data: relaySignaturesSchema }).parse(await res.json()).data
    expect(signatures).toHaveLength(4)
    expect(new Set(signatures).size).toBe(4)
    expect(events).toEqual([
      'start 0',
      'end 0',
      'start 1',
      'end 1',
      'start 2',
      'end 2',
      'start 3',
      'end 3',
    ])
  })

  it('rejects the whole batch before sending anything when one transaction fails validation', async () => {
    const { post, events } = build()
    const res = await post('/relay/proofs', { transactions: [PROOFS[0], wire('transfer')] })
    expect(res.status).toBe(400)
    const error = await errorOf(res)
    expect(error.code).toBe('INVALID_INPUT')
    expect(error.details?.reason).toMatch(/^transaction 1: fee payer/)
    expect(events).toEqual([])
  })

  it('rejects a close transaction in proofs mode', async () => {
    const { post } = build()
    const res = await post('/relay/proofs', { transactions: [wire('close')] })
    expect(res.status).toBe(400)
    expect((await errorOf(res)).details?.reason).toMatch(/^transaction 0: instruction 0:/)
  })

  it('rejects an envelope outside the schema without touching the payer', async () => {
    const { post, events } = build()
    for (const body of [
      { transactions: [] },
      { transactions: [...PROOFS, PROOFS[0]] },
      { transactions: ['not base64!'] },
      { transactions: 'x' },
      {},
      '{not json',
    ]) {
      const res = await post('/relay/proofs', body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await errorOf(res)).code).toBe('INVALID_INPUT')
    }
    expect(events).toEqual([])
  })

  it('answers 400 with the confirmed signatures when the network rejects a later transaction', async () => {
    const { post, events } = build([
      (signature) => ({ ok: true, signature }),
      { ok: false, kind: 'rejected', reason: 'blockhash expired before confirmation' },
    ])
    const res = await post('/relay/proofs', { transactions: PROOFS.slice(0, 3) })
    expect(res.status).toBe(400)
    const error = await errorOf(res)
    expect(error.code).toBe('INVALID_INPUT')
    expect(error.details?.reason).toBe('transaction 1: blockhash expired before confirmation')
    expect(error.details?.signatures).toHaveLength(1)
    expect(events).toEqual(['start 0', 'end 0', 'start 1', 'end 1'])
  })

  it('answers 500 with the confirmed signatures when the rpc fails', async () => {
    const { post } = build([
      (signature) => ({ ok: true, signature }),
      (signature) => ({ ok: true, signature }),
      { ok: false, kind: 'failed', reason: 'ECONNREFUSED' },
    ])
    const res = await post('/relay/proofs', { transactions: PROOFS })
    expect(res.status).toBe(500)
    const error = await errorOf(res)
    expect(error.code).toBe('INTERNAL')
    expect(error.details?.reason).toBe('transaction 2: ECONNREFUSED')
    expect(error.details?.signatures).toHaveLength(2)
  })
})

describe('POST /relay/close', () => {
  it('relays the close transaction', async () => {
    const { post, events } = build()
    const res = await post('/relay/close', { transactions: [wire('close')] })
    expect(res.status).toBe(200)
    expect(
      z.object({ data: relaySignaturesSchema }).parse(await res.json()).data.signatures,
    ).toHaveLength(1)
    expect(events).toEqual(['start 0', 'end 0'])
  })

  it('rejects proof transactions in close mode', async () => {
    const { post, events } = build()
    const res = await post('/relay/close', { transactions: [PROOFS[0]] })
    expect(res.status).toBe(400)
    expect((await errorOf(res)).details?.reason).toMatch(/^transaction 0: instruction 0:/)
    expect(events).toEqual([])
  })
})
