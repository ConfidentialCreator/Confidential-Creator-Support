import { readFileSync } from 'node:fs'
import { CCSUPPORT_PROGRAM_ADDRESS, getPledgedEventEncoder } from '@ccsupport/chain'
import { type Address, getBase64Decoder } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseEvents } from './events.ts'

const FIXTURE_DIR = new URL('../../../fixtures/logs/', import.meta.url)
const fixtureSchema = z.object({ logMessages: z.array(z.string()) })
const logsOf = (name: string): string[] =>
  fixtureSchema.parse(JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_DIR), 'utf8')))
    .logMessages

const CREATOR = '6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk' as Address
const SUPPORTER_0 = 'FQqLH29wPz6vwGhe9MSxzEFZg7qfzrZkW2bKcY91GAZw' as Address

const pledgedLine = () =>
  `Program data: ${getBase64Decoder().decode(
    getPledgedEventEncoder().encode({
      creator: CREATOR,
      supporter: SUPPORTER_0,
      periods: 1,
      startedAt: 1,
      expiresAt: 2,
      periodsTotal: 1,
      contributions: 1,
      showPublicly: false,
      slot: 3,
    }),
  )}`

describe('parseEvents', () => {
  it('reads CreatorRegistered from a real register transaction', () => {
    const events = parseEvents(logsOf('register'))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'creatorRegistered',
      data: {
        wallet: CREATOR,
        handle: 'marrow-dispatch',
        name: 'The Marrow Dispatch',
        suggestedAmount: 0n,
        slot: 498814836n,
      },
    })
  })

  it('reads CreatorUpdated with the new profile', () => {
    const events = parseEvents(logsOf('update'))
    expect(events).toEqual([
      {
        kind: 'creatorUpdated',
        data: {
          wallet: CREATOR,
          handle: 'marrow-dispatch',
          name: 'The Marrow Dispatch',
          description:
            'Independent reporting on municipal budgets and public procurement. Weekly, with sources.',
          suggestedAmount: 5_000_000n,
          slot: 498851479n,
        },
      },
    ])
  })

  it('reads Pledged for a first and a renewal contribution', () => {
    const [first] = parseEvents(logsOf('pledge-first'))
    expect(first).toMatchObject({
      kind: 'pledged',
      data: { creator: CREATOR, supporter: SUPPORTER_0, periods: 1, contributions: 1 },
    })
    const [renewal] = parseEvents(logsOf('pledge-renewal'))
    expect(renewal).toMatchObject({
      kind: 'pledged',
      data: { creator: CREATOR, supporter: SUPPORTER_0, periods: 12, contributions: 2 },
    })
    if (first?.kind !== 'pledged' || renewal?.kind !== 'pledged') throw new Error('kind')
    expect(renewal.data.startedAt).toBe(first.data.startedAt)
    expect(renewal.data.expiresAt).toBeGreaterThan(first.data.expiresAt)
  })

  it('ignores event-shaped data logged by another program', () => {
    const logs = [
      'Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb invoke [1]',
      pledgedLine(),
      'Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb success',
    ]
    expect(parseEvents(logs)).toEqual([])
  })

  it('reads an event logged by our program under a CPI depth', () => {
    const logs = [
      'Program Other11111111111111111111111111111111111 invoke [1]',
      `Program ${CCSUPPORT_PROGRAM_ADDRESS} invoke [2]`,
      pledgedLine(),
      `Program ${CCSUPPORT_PROGRAM_ADDRESS} success`,
      'Program Other11111111111111111111111111111111111 success',
    ]
    expect(parseEvents(logs)).toHaveLength(1)
  })

  it('skips an unknown discriminator and returns nothing for logs without events', () => {
    const logs = [
      `Program ${CCSUPPORT_PROGRAM_ADDRESS} invoke [1]`,
      `Program data: ${Buffer.alloc(16, 7).toString('base64')}`,
      `Program ${CCSUPPORT_PROGRAM_ADDRESS} success`,
    ]
    expect(parseEvents(logs)).toEqual([])
    expect(parseEvents([])).toEqual([])
  })

  it('throws on a truncated event instead of indexing half a pledge', () => {
    const line = pledgedLine()
    const truncated = `${line.slice(0, line.length - 20)}`
    const logs = [`Program ${CCSUPPORT_PROGRAM_ADDRESS} invoke [1]`, truncated]
    expect(() => parseEvents(logs)).toThrow()
  })
})
