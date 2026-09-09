import {
  CCSUPPORT_PROGRAM_ADDRESS,
  CREATOR_REGISTERED_EVENT_DISCRIMINATOR,
  CREATOR_UPDATED_EVENT_DISCRIMINATOR,
  type CreatorRegisteredEvent,
  type CreatorUpdatedEvent,
  getCreatorRegisteredEventDecoder,
  getCreatorUpdatedEventDecoder,
  getPledgedEventDecoder,
  PLEDGED_EVENT_DISCRIMINATOR,
  type PledgedEvent,
} from '@ccsupport/chain'
import { containsBytes, getBase64Encoder, type ReadonlyUint8Array } from '@solana/kit'

export type ProgramEvent =
  | { kind: 'creatorRegistered'; data: CreatorRegisteredEvent }
  | { kind: 'creatorUpdated'; data: CreatorUpdatedEvent }
  | { kind: 'pledged'; data: PledgedEvent }

// Base58 program id, so `Program log: success` from a program never pops the stack.
const INVOKE = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[\d+\]$/
const RETURN = /^Program [1-9A-HJ-NP-Za-km-z]{32,44} (?:success|failed)/
const DATA = 'Program data: '

function decodeEvent(bytes: ReadonlyUint8Array): ProgramEvent | null {
  if (containsBytes(bytes, PLEDGED_EVENT_DISCRIMINATOR, 0)) {
    return { kind: 'pledged', data: getPledgedEventDecoder().decode(bytes) }
  }
  if (containsBytes(bytes, CREATOR_REGISTERED_EVENT_DISCRIMINATOR, 0)) {
    return { kind: 'creatorRegistered', data: getCreatorRegisteredEventDecoder().decode(bytes) }
  }
  if (containsBytes(bytes, CREATOR_UPDATED_EVENT_DISCRIMINATOR, 0)) {
    return { kind: 'creatorUpdated', data: getCreatorUpdatedEventDecoder().decode(bytes) }
  }
  return null
}

// `Program data:` lines belong to whichever program is on top of the invoke stack, so
// another program's event with a colliding discriminator is never read as ours.
export function parseEvents(logs: readonly string[]): ProgramEvent[] {
  const stack: string[] = []
  const events: ProgramEvent[] = []
  for (const line of logs) {
    const invoke = INVOKE.exec(line)
    if (invoke?.[1] !== undefined) {
      stack.push(invoke[1])
      continue
    }
    if (RETURN.test(line)) {
      stack.pop()
      continue
    }
    if (!line.startsWith(DATA) || stack.at(-1) !== CCSUPPORT_PROGRAM_ADDRESS) continue
    const event = decodeEvent(getBase64Encoder().encode(line.slice(DATA.length)))
    if (event !== null) events.push(event)
  }
  return events
}
