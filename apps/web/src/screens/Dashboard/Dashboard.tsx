import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Chrome, Kv, Mono, routes } from '../../components/Chrome.tsx'
import { Sealed } from '../../components/Sealed.tsx'
import { MonthsTable, PaymentsTable } from '../../components/SealedTables.tsx'
import { liftSchedule } from '../../lift.ts'
import { creator, months, payments, totals, trunc, withUnit } from '../../mockData.ts'
import { type Filter, filterPayments } from './filter.ts'

const filters: readonly (readonly [Filter, string])[] = [
  ['all', 'All'],
  ['listed', 'Listed'],
  ['hidden', 'Not listed'],
]

export function Dashboard() {
  const [revealed, setRevealed] = useState(false)
  const [settled, setSettled] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  const rows = filterPayments(payments, filter)
  const schedule = liftSchedule([rows.length, months.length])
  const totalsStart = schedule.end

  useEffect(() => {
    if (!revealed) return
    const timer = setTimeout(() => setSettled(true), schedule.settled)
    return () => clearTimeout(timer)
  }, [revealed, schedule.settled])

  return (
    <Chrome>
      <h1 className="text-2xl font-normal">{creator.publication}</h1>
      <div className="mt-1 text-xs italic text-muted">
        <Mono>{trunc(creator.wallet)}</Mono> · publishing since {creator.since} · suggested{' '}
        {withUnit(creator.suggested)}
      </div>

      <h2>Keys</h2>
      <p className="mb-3">
        Your decryption key is derived from a wallet signature and held in this tab only.
      </p>
      <p className="mb-3">
        <button
          type="button"
          className={revealed ? 'act act-off' : 'act'}
          disabled={revealed}
          onClick={() => setRevealed(true)}
        >
          Sign to derive keys
        </button>
      </p>
      {settled && (
        <div className="help">
          {totals.paymentsSeptember} payments revealed in {totals.revealSeconds} s
        </div>
      )}

      <h2>Standing</h2>
      <Kv
        rows={[
          ['Active supporters', String(totals.active)],
          ['Renewals due within 7 days', String(totals.renewalsDue)],
          ['Listed publicly', String(totals.listed)],
        ]}
      />

      <h2>Received</h2>
      <Kv
        rows={[
          [
            'September so far',
            <Sealed
              key="s"
              revealed={revealed}
              figure={withUnit(totals.september)}
              delayMs={totalsStart}
            />,
          ],
          [
            'Since March 2026',
            <Sealed
              key="l"
              revealed={revealed}
              figure={withUnit(totals.lifetime)}
              delayMs={totalsStart}
            />,
          ],
          [
            'Sealed balance',
            <Sealed
              key="b"
              revealed={revealed}
              figure={withUnit(totals.balance)}
              delayMs={totalsStart}
            />,
          ],
        ]}
      />
      <div className="help">
        Nothing has been withdrawn. Withdrawal moves a sum you choose into your public balance and
        shows only that sum on chain.
      </div>

      <h2>By month</h2>
      <MonthsTable rows={months} lift={{ revealed, startMs: schedule.starts[1] ?? 0 }} />

      <h2>Payments</h2>
      <p className="mb-3">{totals.paymentsSeptember} in September</p>
      <div className="mb-2 flex gap-3 text-xs italic">
        {filters.map(([value, label], i) => (
          <span key={value} className="flex gap-3">
            {i > 0 && <span className="text-muted">·</span>}
            <button
              type="button"
              className={filter === value ? 'border-b border-ink' : 'text-muted'}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          </span>
        ))}
      </div>
      <PaymentsTable rows={rows} lift={{ revealed, startMs: 0 }} />

      <p className="mt-6">
        <Link to={routes.audit} className="act">
          Open the audit tool
        </Link>
      </p>
    </Chrome>
  )
}
