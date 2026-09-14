import {
  type ConfidentialKeys,
  type Creator,
  creatorPda,
  type DecryptResult,
  decryptAvailable,
  decryptPending,
  fetchConfidentialAccount,
  fetchMaybeCreator,
} from '@ccsupport/chain'
import type { Address, CreatorProfile } from '@ccsupport/shared'
import { address, createSolanaRpc } from '@solana/kit'
import { useSelectedWalletAccount } from '@solana/react'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { UiWalletAccount } from '@wallet-standard/react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { type Contribution, fetchAllContributions, fetchCreator } from '../../api/creators.ts'
import { Chrome, Kv, Mono } from '../../components/Chrome.tsx'
import { Sealed } from '../../components/Sealed.tsx'
import { useConfidentialKeys } from '../../confidential/KeysProvider.tsx'
import { webEnv } from '../../config.ts'
import { TOKEN, trunc } from '../../mockData.ts'
import { formatUnits, formatUtc } from '../CreatorPage/format.ts'
import { handleFromBytes } from '../Register/form.ts'
import { formatSeconds, type ReceivedTotals, receivedTotals } from './summary.ts'
import { type Timing, useAmounts } from './useAmounts.ts'

const rpc = createSolanaRpc(webEnv.rpcUrl)
const NONE: readonly Contribution[] = []

export function Dashboard() {
  const [account] = useSelectedWalletAccount()
  return (
    <Chrome>
      {!webEnv.mint ? (
        <p className="mb-3 text-refused">No mint is configured for this deployment.</p>
      ) : account ? (
        <WithAccount key={account.address} account={account} mint={webEnv.mint} />
      ) : (
        <>
          <h1 className="text-2xl font-normal">Creator cabinet</h1>
          <p className="mb-3">
            Connect a wallet above — the cabinet belongs to the creator it holds.
          </p>
        </>
      )}
    </Chrome>
  )
}

function WithAccount({ account, mint }: { account: UiWalletAccount; mint: Address }) {
  const owner = address(account.address)
  const onChain = useQuery({
    queryKey: ['creator-account', account.address],
    queryFn: async () => {
      const [pda] = await creatorPda(owner)
      const maybe = await fetchMaybeCreator(rpc, pda)
      return maybe.exists ? maybe.data : null
    },
    refetchInterval: false,
  })

  if (onChain.isPending) return <div className="help">reading the chain…</div>
  if (onChain.isError) {
    return <div className="text-refused">the chain did not answer: {onChain.error.message}</div>
  }
  if (onChain.data === null) {
    return (
      <>
        <h1 className="text-2xl font-normal">Not a creator yet</h1>
        <p className="mb-3">
          <Mono>{trunc(account.address)}</Mono> has no creator profile on chain.
        </p>
        <p>
          <Link to="/creator/new" className="act">
            Register as a creator
          </Link>
        </p>
      </>
    )
  }
  return <Cabinet owner={owner} mint={mint} creator={onChain.data} />
}

type CabinetProps = { owner: Address; mint: Address; creator: Creator }

function Cabinet({ owner, mint, creator }: CabinetProps) {
  const handle = useMemo(() => handleFromBytes(creator.handle), [creator.handle])
  const { keys, error: keysError, derive } = useConfidentialKeys()
  const profile = useQuery({
    queryKey: ['creator', handle],
    queryFn: () => fetchCreator(webEnv.apiUrl, handle),
  })
  const token = useQuery({
    queryKey: ['token-account', owner, mint],
    queryFn: () => fetchConfidentialAccount(rpc, owner, mint),
  })
  // The index learns the handle from the same transaction as the profile; until
  // then the contributions route answers 404.
  const indexed = profile.data != null
  const contributions = useQuery({
    queryKey: ['contributions', handle],
    queryFn: () => fetchAllContributions(webEnv.apiUrl, handle),
    enabled: indexed,
  })
  const items = contributions.data ?? NONE
  const amounts = useAmounts(keys, owner, items)
  const decimals = token.data?.decimals ?? 0

  const rows = items.map((c) => ({ ...c, amount: amounts.amountOf(c.sig) }))
  const totals = receivedTotals(rows, new Date())
  const balances = useBalances(keys, token.data?.account ?? null)

  return (
    <>
      <h1 className="text-2xl font-normal">{creator.name}</h1>
      <div className="mt-1 text-xs italic text-muted">
        {handle} · <Mono>{trunc(owner)}</Mono>
        {token.data &&
          ` · suggested ${formatUnits(creator.suggestedAmount.toString(), decimals)} ${TOKEN}`}
      </div>

      <h2>Keys</h2>
      <p className="mb-3">
        Your decryption keys are derived from a wallet signature and held in this tab only.
      </p>
      {keys ? (
        <div className="help">
          keys derived · {totals.decrypted + totals.failed} of {items.length} amounts revealed
          {amounts.timing && ` · ${timingText(amounts.timing, items.length)}`}
        </div>
      ) : (
        <p className="mb-3">
          <button
            type="button"
            className={derive ? 'act' : 'act act-off'}
            disabled={!derive}
            onClick={() => derive?.().catch(() => undefined)}
          >
            Sign to derive keys
          </button>
          {keysError && <span className="ml-3 text-refused">{keysError.message}</span>}
        </p>
      )}
      {amounts.error && <div className="text-refused">decryption stopped: {amounts.error}</div>}

      <h2>Standing</h2>
      <Standing profile={profile} contributions={contributions.data ? items.length : null} />

      <h2>Received</h2>
      {token.isError ? (
        <div className="text-refused">the chain did not answer: {token.error.message}</div>
      ) : (
        <Received
          totals={totals}
          balances={balances}
          decimals={decimals}
          revealed={keys !== null && totals.pending === 0}
        />
      )}
      <div className="help">
        Sealed balance is what a withdrawal could move; pending is what arrived since the last
        apply. Withdrawal is not part of this release.
      </div>

      <h2>Contributions</h2>
      {!indexed ? (
        <div className="help">Nothing to show until the index has the profile.</div>
      ) : (
        <Contributions query={contributions} rows={rows} decimals={decimals} />
      )}
    </>
  )
}

type StandingProps = {
  profile: UseQueryResult<CreatorProfile | null>
  contributions: number | null
}

function Standing({ profile, contributions }: StandingProps) {
  if (profile.isError) {
    return <div className="text-refused">the api did not answer: {profile.error.message}</div>
  }
  if (profile.data === null) {
    return (
      <div className="help">
        The index has not seen your registration yet — the public page appears a few seconds after
        the transaction.
      </div>
    )
  }
  const count = (n: number | undefined) => (n === undefined ? '…' : String(n))
  return (
    <Kv
      rows={[
        ['Active supporters', count(profile.data?.activeSupporters)],
        ['Supporters ever', count(profile.data?.totalSupporters)],
        ['Contributions', count(contributions ?? undefined)],
      ]}
    />
  )
}

type ReceivedProps = {
  totals: ReceivedTotals
  balances: Balances
  decimals: number
  revealed: boolean
}

function Received({ totals, balances, decimals, revealed }: ReceivedProps) {
  return (
    <Kv
      rows={[
        [
          'Last 30 days',
          <Figure key="p" units={revealed ? totals.period : null} decimals={decimals} />,
        ],
        [
          'All time',
          <Figure key="l" units={revealed ? totals.lifetime : null} decimals={decimals} />,
        ],
        ['Sealed balance', <Result key="a" result={balances.available} decimals={decimals} />],
        ['Pending', <Result key="n" result={balances.pending} decimals={decimals} />],
      ]}
    />
  )
}

type ContributionsProps = {
  query: UseQueryResult<Contribution[]>
  rows: readonly Row[]
  decimals: number
}

function Contributions({ query, rows, decimals }: ContributionsProps) {
  if (query.isError) {
    return <div className="text-refused">the api did not answer: {query.error.message}</div>
  }
  if (query.isPending) return <div className="help">loading…</div>
  if (rows.length === 0) return <div className="help">Nobody has contributed yet.</div>
  return <ContributionsTable rows={rows} decimals={decimals} />
}

function timingText(timing: Timing, count: number): string {
  const first = timing.firstAt === null ? '…' : formatSeconds(timing.firstAt - timing.startedAt)
  const all = timing.allAt === null ? '…' : formatSeconds(timing.allAt - timing.startedAt)
  return `first amount in ${first} · all ${count} in ${all}`
}

type Balances = { available: DecryptResult | null; pending: DecryptResult | null }

// AES for available is instant; pending is two logarithms (~200 ms) and runs once
// per account read.
function useBalances(
  keys: ConfidentialKeys | null,
  account: Awaited<ReturnType<typeof fetchConfidentialAccount>>['account'],
): Balances {
  return useMemo(() => {
    if (!keys || !account) return { available: null, pending: null }
    return {
      available: decryptAvailable(keys.ae(), account),
      pending: decryptPending(keys.elgamal(), account),
    }
  }, [keys, account])
}

function Figure({ units, decimals }: { units: bigint | null; decimals: number }) {
  if (units === null) return <Sealed revealed={false} />
  return <Sealed revealed figure={`${formatUnits(units.toString(), decimals)} ${TOKEN}`} />
}

const FAILURE_TEXT = {
  'wrong-key': 'not for these keys',
  malformed: 'unreadable',
  unconfigured: 'no confidential account',
} as const

function Result({ result, decimals }: { result: DecryptResult | null; decimals: number }) {
  if (result && !result.ok) return <span className="text-muted">{FAILURE_TEXT[result.reason]}</span>
  return <Figure units={result ? result.units : null} decimals={decimals} />
}

type Row = Contribution & { amount: DecryptResult | undefined }

function ContributionsTable({ rows, decimals }: { rows: readonly Row[]; decimals: number }) {
  return (
    <table className="stack w-full border-collapse">
      <thead>
        <tr>
          <th>When (UTC)</th>
          <th>Supporter</th>
          <th className="text-right">Periods</th>
          <th className="text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.sig}>
            <td data-l="When (UTC)">{formatUtc(new Date(r.blockTime))}</td>
            <td data-l="Supporter">
              <Mono>{trunc(r.supporter)}</Mono>
            </td>
            <td className="num text-right" data-l="Periods">
              {r.periods}
            </td>
            <td className="num text-right" data-l="Amount">
              <Result result={r.amount ?? null} decimals={decimals} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
