import { useState } from 'react'
import { Link } from 'react-router'
import { Chrome, Mono, routes } from '../../components/Chrome.tsx'
import { Sealed } from '../../components/Sealed.tsx'
import { creator, endDate, reader, TOKEN, trunc } from '../../mockData.ts'
import { confirmations, isInsufficient, type Mode, parseAmount, steps } from './flow.ts'

const balance = reader.publicBalance.toFixed(2)

export function Support() {
  const [mode, setMode] = useState<Mode>('first')
  const [amount, setAmount] = useState<string>(creator.suggested)
  const [periods, setPeriods] = useState(1)
  const [list, setList] = useState(false)
  const [sent, setSent] = useState(false)

  const insufficient = isInsufficient(amount, reader.publicBalance)
  const valid = parseAmount(amount) !== null && !insufficient
  const ends = endDate(periods)

  return (
    <Chrome>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-normal">Support {creator.publication}</h1>
          <div className="mt-1 text-xs italic text-muted">
            as <Mono>{trunc(reader.wallet)}</Mono> · {balance} {TOKEN} in your wallet · sealed
            balance {reader.sealedBalance[mode]} {TOKEN}
          </div>
        </div>
        <div className="flex gap-2 text-xs italic">
          <span>View as:</span>
          <ModeSwitch current={mode} value="first" onPick={setMode}>
            first support
          </ModeSwitch>
          <span className="text-muted">·</span>
          <ModeSwitch current={mode} value="returning" onPick={setMode}>
            returning supporter
          </ModeSwitch>
        </div>
      </div>

      {sent ? (
        <>
          <div className="mt-4 border-t border-b border-t-ink border-b-rule py-3">
            Recorded. <Mono>{trunc(reader.wallet)}</Mono> supports {creator.publication} until{' '}
            {ends}. Signature <Mono>{trunc(reader.signature)}</Mono>.
          </div>
          <div className="help mt-4 mb-1">What the explorer shows</div>
          <div className="clip">
            <div className="font-mono text-xs">
              Confidential transfer · {trunc(reader.wallet)} → {trunc(creator.wallet)} · amount{' '}
              <Sealed revealed={false} />
            </div>
            <div className="font-mono text-xs">
              ccsupport · pledge · periods {periods} · until {ends}
            </div>
            <div className="font-mono text-xs">signature {trunc(reader.signature)}</div>
          </div>
          <p className="mt-6">
            <Link to={routes.page} className="act">
              Back to the page
            </Link>
          </p>
        </>
      ) : (
        <>
          <h2>Amount</h2>
          <div className="flex items-baseline gap-4">
            <input
              className="w-[8ch] text-right"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Amount"
            />
            <span>{TOKEN}</span>
          </div>
          <div className="help">
            Any amount is support. The creator sees it; the page never does.
          </div>
          {insufficient && (
            <p className="mt-2 text-refused">
              Not enough {TOKEN} in your wallet — {balance} available. Nothing has been sent.
            </p>
          )}

          <h2>Periods</h2>
          <div className="flex items-baseline gap-4">
            <button
              type="button"
              className="act px-2.5"
              onClick={() => setPeriods(Math.max(1, periods - 1))}
            >
              −
            </button>
            <span>{periods}</span>
            <button
              type="button"
              className="act px-2.5"
              onClick={() => setPeriods(Math.min(12, periods + 1))}
            >
              +
            </button>
            <span>
              {periods} {periods === 1 ? 'period' : 'periods'} = {periods * 30} days · until {ends}
            </span>
          </div>
          <div className="help">
            One payment covers all chosen periods. Nothing renews by itself; you will be reminded
            before the end date.
          </div>

          <h2>Listing</h2>
          <label className="flex items-baseline gap-4">
            <input type="checkbox" checked={list} onChange={(e) => setList(e.target.checked)} />
            <span>List my wallet on the creator's page</span>
          </label>
          <div className="help">
            Your wallet is on chain either way. This only decides whether the page lists it.
          </div>

          <h2>Steps</h2>
          <ol className="steps">
            {steps(mode, amount).map((text, i) => (
              <li key={text}>
                {i + 1} {text}
              </li>
            ))}
          </ol>
          <div className="help">{confirmations(mode)}</div>

          <p className="mt-6">
            <button
              type="button"
              className={valid ? 'act' : 'act act-off'}
              disabled={!valid}
              onClick={() => setSent(true)}
            >
              Support
            </button>
          </p>
        </>
      )}
    </Chrome>
  )
}

function ModeSwitch({
  current,
  value,
  onPick,
  children,
}: {
  current: Mode
  value: Mode
  onPick: (m: Mode) => void
  children: string
}) {
  return (
    <button
      type="button"
      className={current === value ? 'border-b border-ink' : 'text-muted'}
      onClick={() => onPick(value)}
    >
      {children}
    </button>
  )
}
