import { describe, expect, it } from 'vitest'
import { BINARY_REFUSAL_TEXT, explainKeyFailure } from './explain.ts'

describe('explainKeyFailure', () => {
  it("turns Phantom's binary-message refusal into advice, keeping the original as the cause", () => {
    const refusal = new Error('You cannot sign solana transactions using sign message')
    const explained = explainKeyFailure(refusal)
    expect(explained.message).toBe(BINARY_REFUSAL_TEXT)
    expect(explained.message).toContain('Solflare')
    expect(explained.cause).toBe(refusal)
  })

  it('leaves every other failure as it was', () => {
    const rejected = new Error('User rejected the request.')
    expect(explainKeyFailure(rejected)).toBe(rejected)
  })
})
