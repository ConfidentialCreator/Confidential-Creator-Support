import { SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, SolanaError } from '@solana/kit'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { serializeErr } from './log.ts'

const rateLimited = () =>
  new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
    headers: new Headers(),
    message: 'max usage reached',
    statusCode: 429,
  })

function capture(serializers?: { err: typeof serializeErr }) {
  const lines: string[] = []
  const logger = pino({ ...(serializers && { serializers }) }, { write: (l) => lines.push(l) })
  return { logger, lines }
}

describe('serializeErr', () => {
  it("fails without it: pino's own serializer throws on a kit http error", () => {
    const { logger } = capture()
    expect(() => logger.error({ err: rateLimited() }, 'rpc failed')).toThrow(/not extensible/)
  })

  it('logs a kit http error with its status and message', () => {
    const { logger, lines } = capture({ err: serializeErr })
    logger.error({ err: rateLimited() }, 'rpc failed')
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      msg: 'rpc failed',
      err: {
        type: 'SolanaError',
        context: { statusCode: 429, message: 'max usage reached' },
      },
    })
  })

  it('leaves the logged error itself untouched', () => {
    const err = rateLimited()
    serializeErr(err)
    expect(Object.isFrozen(err.context)).toBe(true)
    expect(Object.getOwnPropertySymbols(err)).toEqual([])
  })

  it('serializes a plain error as pino does, with type, message and stack', () => {
    const { logger, lines } = capture({ err: serializeErr })
    logger.error({ err: new Error('ECONNREFUSED') }, 'rpc failed')
    const { err } = JSON.parse(lines[0] ?? '')
    expect(err).toMatchObject({ type: 'Error', message: 'ECONNREFUSED' })
    expect(err.stack).toContain('ECONNREFUSED')
  })

  it('returns a value that is not an error as it is', () => {
    expect(serializeErr('offline')).toBe('offline')
  })
})
