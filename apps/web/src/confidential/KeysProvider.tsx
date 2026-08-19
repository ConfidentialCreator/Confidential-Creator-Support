import type { ConfidentialKeys } from '@ccsupport/chain'
import type { Address } from '@ccsupport/shared'
import { useSelectedWalletAccount, useWalletAccountMessageSigner } from '@solana/react'
import type { UiWalletAccount } from '@wallet-standard/react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { createKeySession, type DeriveKeys, type KeySession } from './session.ts'

export type ConfidentialKeysState = {
  keys: ConfidentialKeys | null
  error: Error | null
  // null when there is no wallet to sign with or no mint to bind the keys to
  derive: (() => Promise<void>) | null
  forget: () => void
}

const idle: ConfidentialKeysState = { keys: null, error: null, derive: null, forget: () => {} }

const ConfidentialKeysContext = createContext<ConfidentialKeysState>(idle)

export const useConfidentialKeys = () => useContext(ConfidentialKeysContext)

type Props = { deriveKeys: DeriveKeys; mint: Address | undefined; children: ReactNode }

// The secrets live only here — in React state and the session map — never in storage.
// Both are dropped when the selected wallet changes.
export function ConfidentialKeysProvider({ deriveKeys, mint, children }: Props) {
  const [account] = useSelectedWalletAccount()
  const session = useMemo(() => createKeySession(deriveKeys), [deriveKeys])

  if (!account || !mint) {
    return (
      <ConfidentialKeysContext.Provider value={idle}>{children}</ConfidentialKeysContext.Provider>
    )
  }
  return (
    <WithSigner key={account.address} account={account} mint={mint} session={session}>
      {children}
    </WithSigner>
  )
}

type SignerProps = {
  account: UiWalletAccount
  mint: Address
  session: KeySession
  children: ReactNode
}

function WithSigner({ account, mint, session, children }: SignerProps) {
  const signer = useWalletAccountMessageSigner(account)
  const [keys, setKeys] = useState<ConfidentialKeys | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => () => session.forget(), [session])

  const derive = useCallback(async () => {
    setError(null)
    try {
      setKeys(await session.get(signer, account.address as Address, mint))
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  }, [session, signer, account.address, mint])

  const forget = useCallback(() => {
    session.forget()
    setKeys(null)
    setError(null)
  }, [session])

  const value = useMemo(() => ({ keys, error, derive, forget }), [keys, error, derive, forget])

  return (
    <ConfidentialKeysContext.Provider value={value}>{children}</ConfidentialKeysContext.Provider>
  )
}
