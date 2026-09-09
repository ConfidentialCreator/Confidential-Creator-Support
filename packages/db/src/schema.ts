import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

// drizzle-orm 0.45 has no bytea column. postgres.js hands bytea back as a Buffer from
// its read pool, so the row gets its own copy.
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => {
    if (!Buffer.isBuffer(value)) throw new TypeError('bytea column did not come back as a Buffer')
    return Uint8Array.from(value)
  },
})

const u64 = (name: string) => numeric(name, { precision: 20, scale: 0 })

// Backfill cursor of the index, one row per program.
export const indexerState = pgTable('indexer_state', {
  id: text('id').primaryKey(),
  lastSig: text('last_sig'),
  lastSlot: u64('last_slot'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const creators = pgTable('creators', {
  wallet: text('wallet').primaryKey(),
  handle: text('handle').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  suggestedAmount: u64('suggested_amount').notNull(),
  createdSlot: u64('created_slot').notNull(),
  indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull(),
})

export const pledges = pgTable(
  'pledges',
  {
    creator: text('creator')
      .notNull()
      .references(() => creators.wallet),
    supporter: text('supporter').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    periodsTotal: integer('periods_total').notNull(),
    contributions: integer('contributions').notNull(),
    showPublicly: boolean('show_publicly').notNull(),
    lastSig: text('last_sig').notNull(),
    lastSlot: u64('last_slot').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.creator, t.supporter] }),
    index('pledges_creator_expires_idx').on(t.creator, t.expiresAt),
  ],
)

export const contributionKind = pgEnum('contribution_kind', ['first', 'renewal'])

// No sum anywhere: grouped_lo/hi is the recipient's ElGamal ciphertext taken from the
// validity-proof context (the Transfer itself carries only the auditor's), and without
// the creator's key it is 256 bytes of noise.
export const contributions = pgTable(
  'contributions',
  {
    sig: text('sig').primaryKey(),
    creator: text('creator').notNull(),
    supporter: text('supporter').notNull(),
    slot: u64('slot').notNull(),
    blockTime: timestamp('block_time', { withTimezone: true }).notNull(),
    periods: smallint('periods').notNull(),
    kind: contributionKind('kind').notNull(),
    groupedLo: bytea('grouped_lo').notNull(),
    groupedHi: bytea('grouped_hi').notNull(),
    proofSig: text('proof_sig').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.creator, t.supporter],
      foreignColumns: [pledges.creator, pledges.supporter],
    }),
    index('contributions_creator_slot_idx').on(t.creator, t.slot),
    index('contributions_supporter_slot_idx').on(t.supporter, t.slot),
    check('contributions_grouped_lo_len', sql`octet_length(${t.groupedLo}) = 128`),
    check('contributions_grouped_hi_len', sql`octet_length(${t.groupedHi}) = 128`),
  ],
)
