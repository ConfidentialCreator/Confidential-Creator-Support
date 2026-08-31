import { deriveConfidentialKeys } from '@ccsupport/chain'
import { SelectedWalletAccountContextProvider } from '@solana/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UiWallet } from '@wallet-standard/react'
import type { ReactNode } from 'react'
import { ConfidentialKeysProvider } from './confidential/KeysProvider.tsx'
import { webEnv } from './config.ts'

export const POLL_MS = 10_000

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchInterval: POLL_MS, retry: false } },
})

// Key derivation (FR-017) needs a message signature; a wallet without it cannot
// hold a sealed balance here at all.
const canSignMessages = (wallet: UiWallet) => wallet.features.includes('solana:signMessage')

// Only the identifier of the chosen account (`<wallet name>:<address>`) — no secret.
const SELECTED_WALLET_KEY = 'ccsupport:selected-wallet'
const walletStateSync = {
  getSelectedWallet: () => localStorage.getItem(SELECTED_WALLET_KEY),
  storeSelectedWallet: (accountKey: string) =>
    localStorage.setItem(SELECTED_WALLET_KEY, accountKey),
  deleteSelectedWallet: () => localStorage.removeItem(SELECTED_WALLET_KEY),
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SelectedWalletAccountContextProvider
        filterWallets={canSignMessages}
        stateSync={walletStateSync}
      >
        <ConfidentialKeysProvider deriveKeys={deriveConfidentialKeys} mint={webEnv.mint}>
          {children}
        </ConfidentialKeysProvider>
      </SelectedWalletAccountContextProvider>
    </QueryClientProvider>
  )
}
