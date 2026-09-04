import { apiErrorBodySchema, faucetResponseSchema } from '@ccsupport/shared'
import {
  address,
  blockhash,
  getBase58Decoder,
  getCompiledTransactionMessageDecoder,
  type Signature,
  type Transaction,
} from '@solana/kit'
import { Hono } from 'hono'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AppEnv } from '../env.ts'
import { requestLogger } from '../logger.ts'
import { errorHandler } from '../middleware/errors.ts'
import type { SubmitResult } from '../relay/payer.ts'
import { devnetRoute, FAUCET_LAMPORTS, FAUCET_LIMIT, FAUCET_UNITS } from './devnet.ts'

const FAUCET = address('AJ6LFWEJgLEwkfyWWipZ8Le5fV9QjCV61UCnzv9g5ZUq')
const WALLET = address('D4TkDq52FCqPyvwgQWBDepBumsYKB5ZjroRLfGckrYnQ')
const OTHER = address('6f1QTLNPh59wM26CQx1pnJTUcE814H64JaABjARPvtiC')
const MINT = address('HApEuJSUaLofM9Z7PUhAKfxpHkapxBTmpdsnjG9nud36')
const BLOCKHASH = blockhash('9zwFRXGrRTvgmxRvMyBYyGqYr8WLrN5rBmhdEcGB5b9A')

function build(outcome?: SubmitResult) {
  const sent: Transaction[] = []
  let now = 0
  // The real `submit` signs the fee payer slot first; the fake just numbers the sends.
  const submit = async (transaction: Transaction): Promise<SubmitResult> => {
    sent.push(transaction)
    const signature = getBase58Decoder().decode(new Uint8Array(64).fill(sent.length)) as Signature
    return outcome ?? { ok: true, signature }
  }
  const app = new Hono<AppEnv>()
    .use('*', requestLogger(pino({ level: 'silent' })))
    .onError(errorHandler)
    .route(
      '/',
      devnetRoute({
        faucet: { address: FAUCET, submit },
        mint: MINT,
        latestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }),
        rateLimit: { now: () => now },
      }),
    )
  const post = (body: unknown) =>
    app.request('/devnet/faucet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { post, sent, advance: (ms: number) => (now += ms) }
}

const dataOf = async (res: Response) =>
  z.object({ data: faucetResponseSchema }).parse(await res.json()).data

describe('POST /devnet/faucet', () => {
  it('sends one faucet-signed transaction and answers with the portions', async () => {
    const { post, sent } = build()
    const res = await post({ wallet: WALLET })
    expect(res.status).toBe(200)
    const data = await dataOf(res)
    expect(data.lamports).toBe(Number(FAUCET_LAMPORTS))
    expect(data.units).toBe(Number(FAUCET_UNITS))
    expect(sent).toHaveLength(1)
    const transaction = sent[0]
    if (!transaction) throw new Error('unreachable')
    expect(data.signature).toBe(getBase58Decoder().decode(new Uint8Array(64).fill(1)))
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
    expect(message.staticAccounts[0]).toBe(FAUCET)
    expect(message.header.numSignerAccounts).toBe(1)
    expect(message.lifetimeToken).toBe(BLOCKHASH)
    expect('instructions' in message ? message.instructions : []).toHaveLength(3)
  })

  it('allows FAUCET_LIMIT top-ups per wallet per hour, other wallets untouched', async () => {
    const { post, sent, advance } = build()
    for (let i = 0; i < FAUCET_LIMIT; i += 1)
      expect((await post({ wallet: WALLET })).status).toBe(200)
    const limited = await post({ wallet: WALLET })
    expect(limited.status).toBe(429)
    expect(apiErrorBodySchema.parse(await limited.json()).error.code).toBe('RATE_LIMITED')
    expect(limited.headers.get('Retry-After')).toBe('3600')
    expect((await post({ wallet: OTHER })).status).toBe(200)
    expect(sent).toHaveLength(FAUCET_LIMIT + 1)
    advance(3_600_001)
    expect((await post({ wallet: WALLET })).status).toBe(200)
  })

  it('rejects a malformed wallet before spending anything', async () => {
    const { post, sent } = build()
    const res = await post({ wallet: 'nope' })
    expect(res.status).toBe(400)
    const error = apiErrorBodySchema.parse(await res.json()).error
    expect(error.code).toBe('INVALID_INPUT')
    expect(error.details?.reason).toMatch(/^wallet:/)
    expect(sent).toEqual([])
  })

  it('answers 500 with the reason when the transaction does not land', async () => {
    const { post } = build({ ok: false, kind: 'rejected', reason: 'insufficient funds' })
    const res = await post({ wallet: WALLET })
    expect(res.status).toBe(500)
    const error = apiErrorBodySchema.parse(await res.json()).error
    expect(error.code).toBe('INTERNAL')
    expect(error.details?.reason).toBe('insufficient funds')
  })
})
