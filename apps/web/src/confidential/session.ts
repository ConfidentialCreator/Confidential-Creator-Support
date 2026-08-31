import type { ConfidentialKeys } from '@ccsupport/chain'
import type { Address } from '@ccsupport/shared'
import type { MessageModifyingSigner } from '@solana/kit'

export type DeriveKeys = (
  signer: MessageModifyingSigner,
  owner: Address,
  mint: Address,
) => Promise<ConfidentialKeys>

export type KeySession = {
  get: DeriveKeys
  forget: () => void
}

// One derivation per (owner, mint) for the life of the session: the wallet prompt
// is the cost, and the keys are deterministic anyway. A rejected prompt is not
// remembered, so the next click asks again.
export function createKeySession(derive: DeriveKeys): KeySession {
  const pending = new Map<string, Promise<ConfidentialKeys>>()

  return {
    get(signer, owner, mint) {
      const id = `${owner}:${mint}`
      const known = pending.get(id)
      if (known) return known
      const attempt = derive(signer, owner, mint).catch((err: unknown) => {
        pending.delete(id)
        throw err
      })
      pending.set(id, attempt)
      return attempt
    },
    forget() {
      pending.clear()
    },
  }
}
