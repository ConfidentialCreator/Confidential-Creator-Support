import { pledgePda } from '@ccsupport/chain'
import { type Address, address } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { readVisibility } from './visibility.ts'

const SUPPORTER: Address = address('D4TkDq52FCqPyvwgQWBDepBumsYKB5ZjroRLfGckrYnQ')
const LISTED: Address = address('6znwWkzSGUcgFzLaXHo28o5uaweFn1hNeuW4pcaekQSk')
const HIDDEN: Address = address('G8pLR3S48Yp3uPfDEVBV2xV41bt8FUT7cr5b7LNwSHL8')
const GONE: Address = address('B95bAzKtNAZWXCGaCNY5a9M4fHUJqmkAesXHoz2qBa4V')

describe('readVisibility', () => {
  it('reads every pledge PDA in one call and keys the flag by creator', async () => {
    const calls: Address[][] = []
    const flags = new Map<Address, boolean>([
      [(await pledgePda(LISTED, SUPPORTER))[0], true],
      [(await pledgePda(HIDDEN, SUPPORTER))[0], false],
    ])
    const fetchAll = async (addresses: Address[]) => {
      calls.push(addresses)
      return addresses.map((a) => flags.get(a) ?? null)
    }
    expect(await readVisibility(fetchAll, SUPPORTER, [LISTED, HIDDEN])).toEqual(
      new Map([
        [LISTED, true],
        [HIDDEN, false],
      ]),
    )
    expect(calls).toHaveLength(1)
  })

  it('marks a pledge the chain does not have as null rather than hidden', async () => {
    const fetchAll = async (addresses: Address[]) => addresses.map(() => null)
    expect(await readVisibility(fetchAll, SUPPORTER, [GONE])).toEqual(new Map([[GONE, null]]))
  })

  it('makes no call for a wallet without pledges', async () => {
    let called = false
    const fetchAll = async (addresses: Address[]) => {
      called = true
      return addresses.map(() => null)
    }
    expect(await readVisibility(fetchAll, SUPPORTER, [])).toEqual(new Map())
    expect(called).toBe(false)
  })
})
