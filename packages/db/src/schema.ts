import { pgTable, text } from 'drizzle-orm/pg-core'

// Курсор backfill індексу. Таблиці creators / pledges / contributions — у задачах US1.
export const indexerState = pgTable('indexer_state', {
  id: text('id').primaryKey(),
  lastSig: text('last_sig'),
})
