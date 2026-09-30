import type { CreatorProfile } from '@ccsupport/shared'
import { historyColumns } from './history.ts'

export function History({ profile }: { profile: CreatorProfile }) {
  const columns = historyColumns(profile.series)
  if (columns.length === 0) {
    return <p className="mb-3">Nobody has supported {profile.name} yet.</p>
  }
  return (
    <>
      {/* The table below carries every figure, so the chart stays out of the reading order. */}
      <div aria-hidden="true">
        <div className="chart">
          {columns.map((c) => (
            <div
              key={c.month}
              className="flex h-full max-w-20 flex-1 flex-col items-center justify-end"
            >
              <div className="mb-1 text-xs">{c.active}</div>
              <div className="w-full bg-ink" style={{ height: `${c.height}%` }} />
            </div>
          ))}
        </div>
        <div className="chart-l">
          {columns.map((c) => (
            <div key={c.month} className="max-w-20 flex-1 pt-1 text-center text-xs text-muted">
              {c.short}
            </div>
          ))}
        </div>
      </div>
      <table className="stack mt-4 w-full border-collapse">
        <thead>
          <tr>
            <th>Month</th>
            <th className="text-right">Supporters</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.month}>
              <td data-l="Month">
                {c.long}
                {c.running ? ' (so far)' : ''}
              </td>
              <td className="num text-right" data-l="Supporters">
                {c.active}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="help">
        A month counts everyone whose support covered at least one day of it, in UTC. The current
        month still counts those whose support ended in it, so it can be higher than the active
        count at the top of the page. These are counts of people; no figure here is an amount.
      </div>
    </>
  )
}
