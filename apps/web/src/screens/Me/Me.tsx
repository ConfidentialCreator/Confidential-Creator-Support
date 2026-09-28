import { fetchAllMaybePledge, setVisibilityInstruction } from '@ccsupport/chain'
import { address, createSolanaRpc, type TransactionSendingSigner } from '@solana/kit'
import { useSelectedWalletAccount, useWalletAccountTransactionSendingSigner } from '@solana/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { UiWalletAccount } from '@wallet-standard/react'
import { Link } from 'react-router'
import { fetchSupporterPledges, type SupporterPledge } from '../../api/supporters.ts'
import { Chrome, Mono } from '../../components/Chrome.tsx'
import { webEnv } from '../../config.ts'
import { chainPort, sendInstruction, waitConfirmed } from '../Register/submit.ts'
import { formatExpiry } from '../Support/expiry.ts'
import { reminder, splitPledges, standing } from './pledges.ts'
import { type FetchFlags, readVisibility } from './visibility.ts'

const rpc = createSolanaRpc(webEnv.rpcUrl)
const port = chainPort(rpc)
const fetchFlags: FetchFlags = async (pdas) =>
  (await fetchAllMaybePledge(rpc, pdas, { commitment: 'confirmed' })).map((a) =>
    a.exists ? a.data.showPublicly : null,
  )

export function Me() {
  const [account] = useSelectedWalletAccount()
  return (
    <Chrome>
      <h1 className="text-2xl font-normal">My support</h1>
      {!account ? (
        <p className="mb-3">Connect a wallet above — this page lists the pledges it signed.</p>
      ) : (
        <WithAccount key={account.address} account={account} />
      )}
    </Chrome>
  )
}

function WithAccount({ account }: { account: UiWalletAccount }) {
  const signer = useWalletAccountTransactionSendingSigner(account, webEnv.chain)
  const owner = address(account.address)
  const pledges = useQuery({
    queryKey: ['supporter-pledges', account.address],
    queryFn: () => fetchSupporterPledges(webEnv.apiUrl, account.address),
  })
  const creators = pledges.data?.map((p) => p.creator) ?? []
  const visibility = useQuery({
    queryKey: ['visibility', account.address, creators],
    queryFn: () => readVisibility(fetchFlags, owner, creators),
    enabled: pledges.isSuccess,
    refetchInterval: false,
  })

  if (pledges.isPending) return <div className="help">loading your pledges…</div>
  if (pledges.isError) {
    return <div className="text-refused">the api did not answer: {pledges.error.message}</div>
  }
  if (pledges.data.length === 0) {
    return <p className="mb-3">This wallet has not supported anyone yet.</p>
  }
  const { current, ended } = splitPledges(pledges.data)
  return (
    <>
      <p className="mb-3">
        Dates and counts only — the amounts stay sealed, here and on every creator's page.
      </p>
      {visibility.isError && (
        <p className="mb-3 text-refused">
          the chain did not answer, listing cannot be changed now: {visibility.error.message}
        </p>
      )}
      <h2>Running</h2>
      {current.length === 0 ? (
        <p className="help">Nothing is running. Renew an ended pledge below to be counted again.</p>
      ) : (
        <Pledges
          rows={current}
          listed={visibility.data}
          signer={signer}
          onToggled={() => visibility.refetch()}
        />
      )}
      {ended.length > 0 && (
        <>
          <h2>Ended</h2>
          <Pledges rows={ended} listed={undefined} signer={signer} onToggled={() => {}} />
        </>
      )}
    </>
  )
}

type PledgesProps = {
  rows: SupporterPledge[]
  listed: Map<string, boolean | null> | undefined
  signer: TransactionSendingSigner
  onToggled: () => void
}

function Pledges({ rows, listed, signer, onToggled }: PledgesProps) {
  return (
    <table className="stack w-full border-collapse">
      <thead>
        <tr>
          <th>Creator</th>
          <th>Term</th>
          <th>Listing</th>
          <th className="text-right">Renewal</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <Row key={p.creator} pledge={p} listed={listed} signer={signer} onToggled={onToggled} />
        ))}
      </tbody>
    </table>
  )
}

type RowProps = Omit<PledgesProps, 'rows'> & { pledge: SupporterPledge }

function Row({ pledge, listed, signer, onToggled }: RowProps) {
  const state = standing(pledge)
  const urgent = state === 'soon' || state === 'grace'
  return (
    <tr>
      <td data-l="Creator">
        <Link to={`/c/${pledge.handle}`} className="act">
          {pledge.name}
        </Link>{' '}
        <Mono>@{pledge.handle}</Mono>
        <div className="help">
          {pledge.contributions} {pledge.contributions === 1 ? 'contribution' : 'contributions'}
        </div>
      </td>
      <td data-l="Term" className={urgent ? 'font-bold' : undefined}>
        {reminder(pledge, formatExpiry)}
      </td>
      <td data-l="Listing">
        {state === 'ended' ? (
          <span className="help">not listed after the end</span>
        ) : (
          <Listing
            pledge={pledge}
            listed={listed?.get(pledge.creator)}
            signer={signer}
            onToggled={onToggled}
          />
        )}
      </td>
      <td data-l="Renewal" className="text-right">
        <Link to={`/support/${pledge.handle}`} className="act">
          renew
        </Link>
      </td>
    </tr>
  )
}

type ListingProps = {
  pledge: SupporterPledge
  listed: boolean | null | undefined
  signer: TransactionSendingSigner
  onToggled: () => void
}

function Listing({ pledge, listed, signer, onToggled }: ListingProps) {
  const toggle = useMutation({
    mutationFn: async (showPublicly: boolean) => {
      const instruction = await setVisibilityInstruction({
        supporter: signer,
        creatorWallet: pledge.creator,
        showPublicly,
      })
      await waitConfirmed(port, await sendInstruction(port, signer, instruction))
    },
    onSuccess: onToggled,
  })
  if (listed === undefined) return <span className="help">reading the chain…</span>
  if (listed === null) return <span className="text-refused">no pledge on chain</span>
  return (
    <>
      <label className="flex items-baseline gap-2">
        <input
          type="checkbox"
          checked={listed}
          disabled={toggle.isPending}
          onChange={(e) => toggle.mutate(e.target.checked)}
        />
        <span>list my wallet</span>
      </label>
      {toggle.isPending && <div className="help">sign in the wallet, then wait for the chain…</div>}
      {toggle.isError && <div className="text-refused">{toggle.error.message}</div>}
    </>
  )
}
