import type { CreatorProfile } from '@ccsupport/shared'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchCreator, fetchSupporters } from '../../api/creators.ts'
import { Chrome, Kv, Mono } from '../../components/Chrome.tsx'
import { Sealed } from '../../components/Sealed.tsx'
import { webEnv } from '../../config.ts'
import { TOKEN, trunc, withUnit } from '../../mockData.ts'
import { formatDay, formatUnits, formatUtc, TOKEN_DECIMALS } from './format.ts'

export function CreatorPage() {
  const { handle = '' } = useParams()
  const creator = useQuery({
    queryKey: ['creator', handle],
    queryFn: () => fetchCreator(webEnv.apiUrl, handle),
  })

  if (creator.isPending) {
    return (
      <Chrome>
        <div className="help">loading {handle}…</div>
      </Chrome>
    )
  }
  if (creator.isError) {
    return (
      <Chrome>
        <div className="text-refused">the api did not answer: {creator.error.message}</div>
      </Chrome>
    )
  }
  if (creator.data === null) {
    return (
      <Chrome>
        <h1 className="text-2xl font-normal">No creator with the handle {handle}</h1>
        <p className="mb-3">
          Nobody has registered it on chain, or the index has not caught up with a registration made
          in the last few seconds.
        </p>
        <p>
          <Link to="/creator/new" className="act">
            Register as a creator
          </Link>
        </p>
      </Chrome>
    )
  }
  return <Profile profile={creator.data} asOf={new Date(creator.dataUpdatedAt)} />
}

function Profile({ profile, asOf }: { profile: CreatorProfile; asOf: Date }) {
  return (
    <Chrome>
      <div className="border-t-2 border-b border-t-ink border-b-rule px-0 pt-3.5 pb-2.5 text-center">
        <h1 className="text-[30px] font-normal leading-[1.1] sm:text-[44px]">{profile.name}</h1>
        <div className="mt-1.5 text-xs text-muted">
          {profile.handle} · registered at slot {profile.createdSlot.toLocaleString('en-US')}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-5">
        <div className="text-[96px] leading-none sm:text-[160px]">{profile.activeSupporters}</div>
        <div className="text-xl sm:text-2xl">people support {profile.name} this period</div>
      </div>
      <div className="help">
        active as of {formatUtc(asOf)} · counted from the chain, not from this site
      </div>

      <h2>About</h2>
      <p className="mb-3">{profile.description}</p>
      <Kv
        rows={[
          ['Suggested support', withUnit(formatUnits(profile.suggestedAmount, TOKEN_DECIMALS))],
          ["Creator's wallet", <Mono key="w">{trunc(profile.wallet)}</Mono>],
          ['Supporters ever', String(profile.totalSupporters)],
        ]}
      />
      <div className="help">
        The suggestion is the creator's; the chain accepts any {TOKEN} figure and tells no one what
        it was.
      </div>

      <h2>Support this reporting</h2>
      <p className="mb-3">
        <Link to={`/support/${profile.handle}`} className="act">
          Support this reporting
        </Link>
      </p>
      <p className="mb-3">
        The fact that you support is public. The amount is sealed — readable by you, the creator and
        the auditor, and by nobody else.
      </p>

      <h2>Listed supporters</h2>
      <Listed handle={profile.handle} />

      <h2>How it is checked</h2>
      <div className="cols">
        <p className="mb-3">
          The record of support is written by a program on chain, and it refers to the transfer that
          paid for it. Without the transfer in the same transaction there is no record; the program
          checks that the transfer exists and that it goes from the supporter to the creator, and it
          never learns the amount.
        </p>
        <p className="mb-3">
          A transfer of the platform's token carries its amount only as a ciphertext. The explorer
          shows who paid whom and when; the sum is a sealed field that only three keys can open —
          the supporter's, the creator's, and the audit key held by the platform operator.
        </p>
        <p className="mb-3">
          A supporter can open one payment of their own with a proof that anyone can check against
          the chain, and the audit key can open all of them. Nothing else can. Anyone can recount
          the number above from the chain without this site.
        </p>
      </div>
    </Chrome>
  )
}

function Listed({ handle }: { handle: string }) {
  const pages = useInfiniteQuery({
    queryKey: ['supporters', handle],
    queryFn: ({ pageParam }) => fetchSupporters(webEnv.apiUrl, handle, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

  if (pages.isPending) return <div className="help">loading…</div>
  if (pages.isError) {
    return <div className="text-refused">the list did not load: {pages.error.message}</div>
  }
  const first = pages.data.pages[0]
  const rows = pages.data.pages.flatMap((page) => page.items)
  return (
    <>
      <p className="mb-3">
        {rows.length}
        {pages.hasNextPage ? '+' : ''} of {first?.count ?? 0} chose to be listed.
      </p>
      <table className="stack w-full border-collapse">
        <thead>
          <tr>
            <th>Wallet</th>
            <th>Since</th>
            <th>Until</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.wallet}>
              <td data-l="Wallet">
                <Mono>{trunc(s.wallet)}</Mono>
              </td>
              <td data-l="Since">{formatDay(s.since)}</td>
              <td data-l="Until">{formatDay(s.expiresAt)}</td>
              <td className="num text-right" data-l="Amount">
                <Sealed revealed={false} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pages.hasNextPage && (
        <p className="mt-3">
          <button
            type="button"
            className="act"
            disabled={pages.isFetchingNextPage}
            onClick={() => pages.fetchNextPage()}
          >
            show more
          </button>
        </p>
      )}
      <div className="help">
        Every supporter is visible on chain. This list is only those who asked to be on it.
      </div>
    </>
  )
}
