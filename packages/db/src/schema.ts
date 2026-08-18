import { numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Backfill cursor of the index, one row per program. creators / pledges /
// contributions arrive with US1.
export const indexerState = pgTable('indexer_state', {
  id: text('id').primaryKey(),
  lastSig: text('last_sig'),
  lastSlot: numeric('last_slot', { precision: 20, scale: 0 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})
