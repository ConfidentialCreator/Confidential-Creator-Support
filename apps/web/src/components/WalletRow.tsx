import { useSelectedWalletAccount } from '@solana/react'
import { type UiWallet, useConnect, useDisconnect } from '@wallet-standard/react'
import { useConfidentialKeys } from '../confidential/KeysProvider.tsx'
import { trunc } from '../mockData.ts'
import { Mono } from './Chrome.tsx'

export function WalletRow() {
  const [account, , wallets] = useSelectedWalletAccount()
  const owner = wallets.find((w) => w.accounts.some((a) => a.address === account?.address))

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs italic text-muted">
      <span>wallet</span>
      {account && owner ? (
        <>
          <Mono>{trunc(account.address)}</Mono>
          <span>· {owner.name}</span>
          <Disconnect wallet={owner} />
          <KeysControl />
        </>
      ) : wallets.length === 0 ? (
        <span>no wallet with message signing found</span>
      ) : (
        wallets.map((wallet) => <Connect key={wallet.name} wallet={wallet} />)
      )}
    </div>
  )
}

function Connect({ wallet }: { wallet: UiWallet }) {
  const [, setAccount] = useSelectedWalletAccount()
  const [isConnecting, connect] = useConnect(wallet)
  return (
    <button
      type="button"
      className="act"
      disabled={isConnecting}
      onClick={async () => {
        const accounts = await connect()
        setAccount(accounts[0])
      }}
    >
      connect {wallet.name}
    </button>
  )
}

function Disconnect({ wallet }: { wallet: UiWallet }) {
  const [, setAccount] = useSelectedWalletAccount()
  const [isDisconnecting, disconnect] = useDisconnect(wallet)
  return (
    <button
      type="button"
      className="act"
      disabled={isDisconnecting}
      onClick={async () => {
        await disconnect()
        setAccount(undefined)
      }}
    >
      disconnect
    </button>
  )
}

function KeysControl() {
  const { keys, error, derive, forget } = useConfidentialKeys()
  if (!derive) return <span>· no mint configured</span>
  if (keys) {
    return (
      <>
        <span>· keys derived</span>
        <button type="button" className="act" onClick={forget}>
          forget
        </button>
      </>
    )
  }
  return (
    <>
      <button type="button" className="act" onClick={derive}>
        derive keys
      </button>
      {error && <span className="text-refused">{error.message}</span>}
    </>
  )
}
