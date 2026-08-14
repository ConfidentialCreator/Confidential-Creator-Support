// Every figure here is a constant from the M0 brief; the only arithmetic is
// `start + periods × 30 days`. The real clock is never read.

export const CLOCK = '2026-09-15 10:00 UTC'
export const DATE = '2026-09-15'
export const SLOT = '371,852,406'
export const TOKEN = 'SUPD'
export const TOKEN_NAME = 'Support Dollar'
export const AUDIT_KEY = 'a7c41e9d5b02f83c6e19d4a70b5c3f28e6d1a94c7b3f0e52d8a6c19f4b7e2d03'

export const creator = {
  name: 'Ilse Marrow',
  publication: 'The Marrow Dispatch',
  handle: 'marrow-dispatch',
  description:
    'Independent reporting from the port cities of the northern coast — customs, shipping, and the people who keep both honest.',
  since: '2026-03-02',
  wallet: 'Ccs1MarrowDemo4kQ9pW2mR7sXb5nLc8dFg3hJt6yUvE',
  suggested: '8.00',
} as const

export const reader = {
  wallet: 'SupZRdr1Demo4kQ9pW2mR7sXb5nLc8dFg3hJt6yUvQ',
  publicBalance: 24.5,
  sealedBalance: { first: '0.00', returning: '16.00' },
  signature: '4hTqDemoSigW8nRz2xLb7cMd4fSg9hJv3yUa6pKm5eQ1',
} as const

export type Month = { name: string; active: number; payments: number; received: string }

export const months: readonly Month[] = [
  { name: 'March 2026', active: 9, payments: 9, received: '88.00' },
  { name: 'April 2026', active: 23, payments: 21, received: '231.00' },
  { name: 'May 2026', active: 41, payments: 34, received: '402.00' },
  { name: 'June 2026', active: 58, payments: 44, received: '615.00' },
  { name: 'July 2026', active: 77, payments: 58, received: '803.00' },
  { name: 'August 2026', active: 104, payments: 98, received: '1,127.00' },
  { name: 'September 2026 (so far)', active: 128, payments: 48, received: '604.00' },
]

export const totals = {
  active: 128,
  paymentsAll: 312,
  paymentsSeptember: 48,
  september: '604.00',
  lifetime: '3,870.00',
  balance: '3,870.00',
  renewalsDue: 4,
  listed: 9,
  revealSeconds: '1.9',
} as const

export type ListedSupporter = { wallet: string; since: string; until: string; note?: string }

export const listed: readonly ListedSupporter[] = [
  {
    wallet: 'Ear1PortDemo3qRw8kP5nTz2xLb7cMd4fSg9hJv6yUaB',
    since: '2026-03-02',
    until: '2026-11-27',
  },
  {
    wallet: 'Ear2QuayDemo7pQw2kR6nTz9xLb4cMd8fSg3hJv1yUcD',
    since: '2026-03-19',
    until: '2026-10-03',
  },
  {
    wallet: 'Ear3TideDemo5qRw4kP7nTz6xLb9cMd2fSg8hJv3yUeF',
    since: '2026-04-30',
    until: '2027-02-14',
  },
  {
    wallet: 'Ear4DockDemo9pQw6kR3nTz8xLb5cMd7fSg4hJv2yUgH',
    since: '2026-06-08',
    until: '2026-09-16',
    note: 'renewal due',
  },
  {
    wallet: 'Ear5PierDemo2qRw9kP4nTz3xLb6cMd5fSg7hJv8yUjK',
    since: '2026-07-21',
    until: '2026-10-21',
  },
  {
    wallet: 'Sup2Hv3lDemo9pQw3kR6nTz8xLb5cMd2fSg7hJv4yUb',
    since: '2026-09-15',
    until: '2026-12-14',
  },
  {
    wallet: 'Sup4Nk7mDemo8pQw5kR2nTz3xLb9cMd6fSg4hJv7yUdE',
    since: '2026-09-14',
    until: '2027-09-09',
  },
  {
    wallet: 'Sup7Ln2qDemo7qRw2kP8nTz5xLb4cMd3fSg6hJv9yUh',
    since: '2026-09-13',
    until: '2026-10-13',
  },
  {
    wallet: 'SupAHd4dDemo8pQw3kR5nTz7xLb2cMd6fSg9hJv4yU',
    since: '2026-09-12',
    until: '2026-10-12',
  },
]

export type Payment = {
  when: string
  wallet: string
  periods: number
  until: string
  listed: boolean
  amount: string
}

const explicitPayments: readonly Payment[] = [
  {
    when: '2026-09-15 09:41',
    wallet: 'Sup1QeXdDemo5kR8nTz2xLb7cMd4fSg9hJv3yUaW6pKm',
    periods: 1,
    until: '2026-10-15',
    listed: false,
    amount: '8.00',
  },
  {
    when: '2026-09-15 07:58',
    wallet: 'Sup2Hv3lDemo9pQw3kR6nTz8xLb5cMd2fSg7hJv4yUb',
    periods: 3,
    until: '2026-12-14',
    listed: true,
    amount: '50.00',
  },
  {
    when: '2026-09-14 22:10',
    wallet: 'Sup3Tr9eDemo2qRw7kP4nTz9xLb3cMd8fSg5hJv6yUc',
    periods: 1,
    until: '2026-10-14',
    listed: false,
    amount: '8.00',
  },
  {
    when: '2026-09-14 18:33',
    wallet: 'Sup4Nk7mDemo8pQw5kR2nTz3xLb9cMd6fSg4hJv7yUdE',
    periods: 12,
    until: '2027-09-09',
    listed: true,
    amount: '100.00',
  },
  {
    when: '2026-09-14 11:05',
    wallet: 'Sup5Br6tDemo6qRw9kP3nTz7xLb2cMd5fSg8hJv1yU',
    periods: 1,
    until: '2026-10-14',
    listed: false,
    amount: '25.00',
  },
  {
    when: '2026-09-13 20:47',
    wallet: 'Sup6Oy8lDemo3pQw8kR7nTz4xLb6cMd9fSg2hJv5yUfG',
    periods: 2,
    until: '2026-11-12',
    listed: false,
    amount: '12.00',
  },
  {
    when: '2026-09-13 16:02',
    wallet: 'Sup7Ln2qDemo7qRw2kP8nTz5xLb4cMd3fSg6hJv9yUh',
    periods: 1,
    until: '2026-10-13',
    listed: true,
    amount: '3.00',
  },
  {
    when: '2026-09-13 09:30',
    wallet: 'Sup8Am5rDemo4pQw6kR9nTz2xLb8cMd7fSg3hJv2yUj',
    periods: 1,
    until: '2026-10-13',
    listed: false,
    amount: '8.00',
  },
  {
    when: '2026-09-12 21:15',
    wallet: 'Sup9Vs3lDemo5qRw4kP7nTz6xLb9cMd2fSg8hJv3yUk',
    periods: 6,
    until: '2027-03-11',
    listed: false,
    amount: '8.00',
  },
  {
    when: '2026-09-12 14:48',
    wallet: 'SupAHd4dDemo8pQw3kR5nTz7xLb2cMd6fSg9hJv4yU',
    periods: 1,
    until: '2026-10-12',
    listed: true,
    amount: '5.00',
  },
  {
    when: '2026-09-12 10:22',
    wallet: 'SupBKw6lDemo2qRw9kP6nTz3xLb5cMd8fSg4hJv7yUm',
    periods: 1,
    until: '2026-10-12',
    listed: false,
    amount: '20.00',
  },
  {
    when: '2026-09-12 08:05',
    wallet: 'SupCFr2oDemo6pQw7kR3nTz8xLb4cMd9fSg2hJv5yUn',
    periods: 2,
    until: '2026-11-11',
    listed: false,
    amount: '8.00',
  },
]

const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_MS = 30 * DAY_MS
const GENERATED_BASE = Date.UTC(2026, 8, 11, 17, 20)
const GENERATED_STEP_MS = (5 * 60 + 13) * 60 * 1000
const GENERATED_AMOUNTS = ['5.00', '8.00', '8.00', '12.00', '3.00', '20.00', '8.00', '15.00']

const isoMinute = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ')
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)

export function generatedPayments(): Payment[] {
  const rows: Payment[] = []
  for (let i = 1; i <= 36; i++) {
    const when = GENERATED_BASE - i * GENERATED_STEP_MS
    const periods = 1 + (i % 3)
    rows.push({
      when: isoMinute(when),
      wallet: `G${String(i).padStart(2, '0')}xDemo5kR8nTz2xLb7cMd4fSg9hJv3yUa`,
      periods,
      until: isoDay(when + periods * PERIOD_MS),
      listed: false,
      amount: GENERATED_AMOUNTS[(i - 1) % 8] ?? '0.00',
    })
  }
  return rows
}

export const payments: readonly Payment[] = [...explicitPayments, ...generatedPayments()]

export function endDate(periods: number): string {
  return isoDay(Date.UTC(2026, 8, 15) + periods * PERIOD_MS)
}

export const trunc = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`

export const withUnit = (figure: string) => `${figure} ${TOKEN}`
