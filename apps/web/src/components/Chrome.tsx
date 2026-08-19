import { Fragment, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import { creator } from '../mockData.ts'
import { ApiStatus } from './ApiStatus.tsx'
import { WalletRow } from './WalletRow.tsx'

export const routes = {
  page: `/c/${creator.handle}`,
  support: `/support/${creator.handle}`,
  cabinet: '/creator',
  audit: '/audit',
} as const

const nav = [
  ['Page', routes.page],
  ['Support', routes.support],
  ['Cabinet', routes.cabinet],
  ['Audit', routes.audit],
] as const

export function Chrome({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-4 pb-10 sm:px-10 sm:pt-5 sm:pb-16">
      <div className="flex flex-wrap justify-between gap-x-4 text-xs italic text-muted">
        <span>Prototype — mock data. Screens are not connected to any network.</span>
        <ApiStatus />
      </div>
      <WalletRow />
      <nav className="my-2 mb-5 flex gap-3">
        {nav.map(([label, to], i) => (
          <span key={to} className="flex gap-3">
            {i > 0 && <span className="text-muted">·</span>}
            <NavLink
              to={to}
              className={({ isActive }) => (isActive ? 'border-b-2 border-ink' : 'text-muted')}
            >
              {label}
            </NavLink>
          </span>
        ))}
      </nav>
      {children}
    </div>
  )
}

export function Kv({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <div className="kv">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <div className="l">{label}</div>
          <div className="v">{value}</div>
        </Fragment>
      ))}
    </div>
  )
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs">{children}</span>
}
