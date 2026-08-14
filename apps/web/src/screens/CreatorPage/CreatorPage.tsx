import { Link } from 'react-router'
import { Chrome, Kv, Mono, routes } from '../../components/Chrome.tsx'
import { Sealed } from '../../components/Sealed.tsx'
import {
  CLOCK,
  creator,
  DATE,
  listed,
  months,
  SLOT,
  totals,
  trunc,
  withUnit,
} from '../../mockData.ts'

function Chart() {
  const max = Math.max(...months.map((m) => m.active))
  return (
    <>
      <div className="chart">
        {months.map((m) => (
          <div key={m.name} className="flex h-full flex-1 flex-col items-center justify-end">
            <div className="mb-1 text-xs">{m.active}</div>
            <div
              className="w-full bg-ink"
              style={{ height: `${Math.round((m.active / max) * 84)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="chart-l">
        {months.map((m) => (
          <div key={m.name} className="flex-1 pt-1 text-center text-xs text-muted">
            {m.name.split(' ')[0]}
          </div>
        ))}
      </div>
    </>
  )
}

export function CreatorPage() {
  return (
    <Chrome>
      <div className="border-t-2 border-b border-t-ink border-b-rule px-0 pt-3.5 pb-2.5 text-center">
        <h1 className="text-[30px] font-normal leading-[1.1] sm:text-[44px]">
          {creator.publication}
        </h1>
        <div className="mt-1.5 text-xs text-muted">
          {creator.publication} · {DATE} · slot {SLOT} · {creator.handle}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-5">
        <div className="text-[96px] leading-none sm:text-[160px]">{totals.active}</div>
        <div className="text-xl sm:text-2xl">people support {creator.publication} this period</div>
      </div>
      <div className="help">active as of {CLOCK} · counted from the chain, not from this site</div>

      <h2>About</h2>
      <p className="mb-3">{creator.description}</p>
      <Kv
        rows={[
          ['Publishing since', creator.since],
          ['Suggested support', withUnit(creator.suggested)],
          ["Creator's wallet", <Mono key="w">{trunc(creator.wallet)}</Mono>],
          ['Payments in', String(totals.paymentsAll)],
        ]}
      />
      <div className="help">
        The suggestion is the creator's; the chain accepts any amount and tells no one what it was.
      </div>

      <h2>Support this reporting</h2>
      <p className="mb-3">
        <Link to={routes.support} className="act">
          Support this reporting
        </Link>
      </p>
      <p className="mb-3">
        The fact that you support is public. The amount is sealed — readable by you, the creator and
        the auditor, and by nobody else.
      </p>

      <h2>Supporters by month</h2>
      <Chart />
      <table className="stack mt-4 w-full border-collapse">
        <thead>
          <tr>
            <th>Month</th>
            <th className="text-right">Active supporters</th>
            <th className="text-right">Payments received</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.name}>
              <td data-l="Month">{m.name}</td>
              <td className="num text-right" data-l="Active">
                {m.active}
              </td>
              <td className="num text-right" data-l="Payments">
                {m.payments}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Listed supporters</h2>
      <p className="mb-3">
        {totals.listed} of {totals.active} chose to be listed.
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
          {listed.map((s) => (
            <tr key={s.wallet}>
              <td data-l="Wallet">
                <Mono>{trunc(s.wallet)}</Mono>
              </td>
              <td data-l="Since">{s.since}</td>
              <td data-l="Until">
                {s.until}
                {s.note ? ` · ${s.note}` : ''}
              </td>
              <td className="num text-right" data-l="Amount">
                <Sealed revealed={false} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="help">
        Every supporter is visible on chain. This list is only those who asked to be on it.
      </div>

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
