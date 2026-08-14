import { useState } from 'react'
import { Link } from 'react-router'
import { Chrome, routes } from '../../components/Chrome.tsx'
import { MonthsTable, PaymentsTable } from '../../components/SealedTables.tsx'
import { liftSchedule } from '../../lift.ts'
import { creator, months, payments, TOKEN_NAME, totals } from '../../mockData.ts'
import { keyFits } from './key.ts'

type Outcome = 'idle' | 'revealed' | 'refused'

export function Audit() {
  const [key, setKey] = useState('')
  const [outcome, setOutcome] = useState<Outcome>('idle')

  const revealed = outcome === 'revealed'
  const schedule = liftSchedule([months.length, payments.length])

  return (
    <Chrome>
      <h1 className="text-2xl font-normal">Audit</h1>
      <div className="mt-1 text-xs italic text-muted">
        {TOKEN_NAME} · one audit key per token · nothing here writes to the chain
      </div>

      <h2>Creator</h2>
      <div>
        <input value={creator.handle} readOnly className="w-[24ch]" aria-label="Creator handle" />
      </div>
      <div className="help">The handle of the page to audit.</div>

      <h2>Audit key</h2>
      <div>
        <input
          type="password"
          className="w-full max-w-[66ch] font-mono text-xs"
          value={key}
          onChange={(e) => {
            setKey(e.target.value)
            setOutcome('idle')
          }}
          aria-label="Audit key"
        />
      </div>
      <div className="help">
        Entered by hand for this session. It never leaves this tab and is forgotten when the tab
        closes.
      </div>
      <p className="mt-4">
        <button
          type="button"
          className="act"
          onClick={() => setOutcome(keyFits(key) ? 'revealed' : 'refused')}
        >
          Load payments
        </button>
      </p>
      {outcome === 'idle' && <div className="help">{totals.paymentsAll} payments · 0 revealed</div>}
      {outcome === 'revealed' && (
        <div className="help">
          {totals.paymentsAll} payments · {totals.paymentsAll} revealed · 0 failed
        </div>
      )}
      {outcome === 'refused' && (
        <>
          <div className="mt-1.5 text-refused">
            This key does not decrypt these payments. 0 of {totals.paymentsAll} revealed.
          </div>
          <div className="help">A wrong key gives no sum, not a wrong one.</div>
        </>
      )}

      <h2>By month</h2>
      <MonthsTable rows={months} lift={{ revealed, startMs: 0 }} />
      <div className="help">Earlier months are shown as totals in this prototype.</div>

      <h2>Payments</h2>
      <p className="mb-3">{totals.paymentsSeptember} in September</p>
      <PaymentsTable rows={payments} lift={{ revealed, startMs: schedule.starts[1] ?? 0 }} />

      <p className="mt-6">
        <Link to={routes.page} className="act">
          Back to the page
        </Link>
      </p>
    </Chrome>
  )
}
