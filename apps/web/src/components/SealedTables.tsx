import { STAGGER_MS } from '../lift.ts'
import { type Month, type Payment, trunc, withUnit } from '../mockData.ts'
import { Mono } from './Chrome.tsx'
import { Sealed } from './Sealed.tsx'

type Lift = { revealed: boolean; startMs: number }

export function PaymentsTable({ rows, lift }: { rows: readonly Payment[]; lift: Lift }) {
  return (
    <table className="stack w-full border-collapse">
      <thead>
        <tr>
          <th>When (UTC)</th>
          <th>Supporter</th>
          <th className="text-right">Periods</th>
          <th>Until</th>
          <th>Listed</th>
          <th className="text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.wallet + r.when}>
            <td data-l="When (UTC)">{r.when}</td>
            <td data-l="Supporter">
              <Mono>{trunc(r.wallet)}</Mono>
            </td>
            <td className="num text-right" data-l="Periods">
              {r.periods}
            </td>
            <td data-l="Until">{r.until}</td>
            <td data-l="Listed">{r.listed ? 'yes' : 'no'}</td>
            <td className="num text-right" data-l="Amount">
              <Sealed
                revealed={lift.revealed}
                figure={withUnit(r.amount)}
                delayMs={lift.startMs + i * STAGGER_MS}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function MonthsTable({ rows, lift }: { rows: readonly Month[]; lift: Lift }) {
  return (
    <table className="stack w-full border-collapse">
      <thead>
        <tr>
          <th>Month</th>
          <th className="text-right">Active supporters</th>
          <th className="text-right">Payments</th>
          <th className="text-right">Received</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m, i) => (
          <tr key={m.name}>
            <td data-l="Month">{m.name}</td>
            <td className="num text-right" data-l="Active">
              {m.active}
            </td>
            <td className="num text-right" data-l="Payments">
              {m.payments}
            </td>
            <td className="num text-right" data-l="Received">
              <Sealed
                revealed={lift.revealed}
                figure={withUnit(m.received)}
                delayMs={lift.startMs + i * STAGGER_MS}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
