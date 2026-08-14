import type { Payment } from '../../mockData.ts'

export type Filter = 'all' | 'listed' | 'hidden'

export function filterPayments(rows: readonly Payment[], filter: Filter): readonly Payment[] {
  if (filter === 'all') return rows
  return rows.filter((r) => r.listed === (filter === 'listed'))
}
