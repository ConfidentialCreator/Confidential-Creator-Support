import { MAX_PERIODS, PERIOD_SECONDS } from '@ccsupport/shared'
import { expiryLines, expiryPlan, formatExpiry } from './expiry.ts'

type PeriodsProps = {
  periods: number
  onChange: (periods: number) => void
  expiresAt: number | null
  disabled: boolean
}

export function Periods({ periods, onChange, expiresAt, disabled }: PeriodsProps) {
  const now = Math.floor(Date.now() / 1000)
  const plan = expiryPlan(now, expiresAt === null ? null : { expiresAt }, periods)
  return (
    <>
      <h2>Periods</h2>
      <div className="flex items-baseline gap-4">
        <button
          type="button"
          className="act px-2.5"
          onClick={() => onChange(Math.max(1, periods - 1))}
          disabled={disabled}
        >
          −
        </button>
        <span>{periods}</span>
        <button
          type="button"
          className="act px-2.5"
          onClick={() => onChange(Math.min(MAX_PERIODS, periods + 1))}
          disabled={disabled}
        >
          +
        </button>
        <span>
          {periods} {periods === 1 ? 'period' : 'periods'} = {(periods * PERIOD_SECONDS) / 86_400}{' '}
          days
        </span>
      </div>
      {expiryLines(plan, (seconds) => formatExpiry(seconds)).map((line) => (
        <p key={line} className="mt-2">
          {line}
        </p>
      ))}
      <div className="help">
        Your time zone. One payment covers all chosen periods. Nothing renews by itself.
      </div>
    </>
  )
}
