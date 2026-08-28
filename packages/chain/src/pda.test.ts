import { readFileSync } from 'node:fs'
import { type Address, address } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { configPda, creatorPda, handlePda, pledgePda } from './pda.ts'

type Pda = { address: string; bump: number }
type Fixture = {
  program: string
  config: Pda
  creator: Pda & { wallet: string }
  handle: Pda & { handle: string }
  pledge: Pda & { creatorWallet: string; supporter: string }
}
const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/pda.json', import.meta.url), 'utf8'),
) as Fixture

const expected = (p: Pda): [Address, number] => [address(p.address), p.bump]

describe('PDA helpers against fixtures/pda.json', () => {
  it('configPda', async () => {
    expect(await configPda()).toEqual(expected(fixture.config))
  })

  it('creatorPda', async () => {
    expect(await creatorPda(address(fixture.creator.wallet))).toEqual(expected(fixture.creator))
  })

  it('handlePda', async () => {
    expect(await handlePda(fixture.handle.handle)).toEqual(expected(fixture.handle))
  })

  it('pledgePda', async () => {
    expect(
      await pledgePda(address(fixture.pledge.creatorWallet), address(fixture.pledge.supporter)),
    ).toEqual(expected(fixture.pledge))
  })
})

describe('handlePda rejects what the program would reject', () => {
  it.each(['Marrow', 'ab', 'marrow_dispatch', 'a'.repeat(33)])('%s', async (bad) => {
    await expect(handlePda(bad)).rejects.toThrow()
  })
})
