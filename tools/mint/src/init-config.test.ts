import {
  CCSUPPORT_PROGRAM_ADDRESS,
  configPda,
  getConfigEncoder,
  parseInitConfigInstruction,
} from '@ccsupport/chain'
import {
  address,
  createSolanaRpcFromTransport,
  generateKeyPairSigner,
  getBase64Decoder,
  type ReadonlyUint8Array,
  type RpcTransport,
} from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { findConfig, initConfigPlan } from './init-config.ts'

const MINT = address('HApEuJSUaLofM9Z7PUhAKfxpHkapxBTmpdsnjG9nud36')
const AUTHORITY = address('AJ6LFWEJgLEwkfyWWipZ8Le5fV9QjCV61UCnzv9g5ZUq')

function rpcWith(data: ReadonlyUint8Array | null) {
  const transport: RpcTransport = async <T>() => {
    const value = data
      ? {
          data: [getBase64Decoder().decode(data), 'base64'],
          executable: false,
          lamports: 1,
          owner: CCSUPPORT_PROGRAM_ADDRESS,
          rentEpoch: 0,
          space: data.length,
        }
      : null
    return { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value } } as T
  }
  return createSolanaRpcFromTransport(transport)
}

describe('findConfig', () => {
  it('returns the stored mint and authority when the PDA exists', async () => {
    const [expected, bump] = await configPda()
    const rpc = rpcWith(getConfigEncoder().encode({ mint: MINT, authority: AUTHORITY, bump }))
    expect(await findConfig(rpc)).toEqual({ address: expected, mint: MINT, authority: AUTHORITY })
  })

  it('is null before init_config', async () => {
    expect(await findConfig(rpcWith(null))).toBeNull()
  })
})

describe('initConfigPlan', () => {
  it('is one init_config instruction on the config PDA signed by the authority', async () => {
    const authority = await generateKeyPairSigner()
    const plan = await initConfigPlan({ authority, mint: MINT })
    if (plan.kind !== 'single') throw new Error('expected a single instruction')
    const ix = plan.instruction
    if (!ix.accounts || !ix.data) throw new Error('expected accounts and data')

    const parsed = parseInitConfigInstruction({ ...ix, accounts: ix.accounts, data: ix.data })
    expect(parsed.programAddress).toBe(CCSUPPORT_PROGRAM_ADDRESS)
    expect(parsed.accounts.config.address).toBe((await configPda())[0])
    expect(parsed.accounts.authority.address).toBe(authority.address)
    expect(parsed.accounts.mint.address).toBe(MINT)
  })
})
