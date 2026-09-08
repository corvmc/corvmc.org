import {
	sqliteTable,
	text,
	integer,
	real,
	index,
	uniqueIndex,
	check
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { eventListing, eventBand } from './event';
import { user } from './authentication';

// ---------------------------------------------------------------------------
// Productions
//
// The ops half of a show, as a 1:1 child of the listing rather than columns on
// it.
//
// The listing is the advertisement — the entry on the gig guide, and the gig
// guide carries far more listings than CMC will ever produce. Load-in times,
// hospitality notes and a producer are true of a night CMC is running and
// simply absent from a band's own backfilled gig, so hanging them off
// `event_listing` would mean a dozen columns that are NULL on the table's
// hottest query. Sparsity is the whole argument for the separate row; it is not
// a second event.
//
// Deliberately **no** `venueId`. Where a show is, is a public fact and lives on
// `event_listing.venueId`. Two columns answering one question is one copy
// nobody updates.
//
// Deliberately **no** settlement snapshot and no `bandSplitPercent`. The acts'
// pool is `sum(ticket.acts_cents)` and the deal is per act, on
// `production_slot` below; adding columns nothing reads is how a table starts
// lying about what it holds.
//
// See `docs/specs/production-workflow-spec.md#production`.
// ---------------------------------------------------------------------------

/**
 * Where a production is in the work of putting a show on.
 *
 * Forward: `draft → offered → confirmed → completed → settled → closed`, with
 * `cancelled` reachable from anything before the show happened. Two walk-backs
 * exist because a mis-click needs a way out: `offered → draft`, and a show
 * booked outright skips `offered` entirely.
 *
 * `settled` and `closed` are in the vocabulary but have no button yet — they
 * are driven by the settlement worksheet and the close-out, neither of which is
 * built. The lifecycle is declared whole so `StatusBadge` maps it whole.
 */
export const productionStatuses = [
	'draft',
	'offered',
	'confirmed',
	'completed',
	'settled',
	'closed',
	'cancelled'
] as const;
export type ProductionStatus = (typeof productionStatuses)[number];

export const production = sqliteTable(
	'production',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		/**
		 * Cascade, matching `event_band`: a production is an ops record for one
		 * night and means nothing without it. `remove()` in `event-service.ts`
		 * already refuses once any ticket exists, so this only ever fires on rows
		 * that should never have existed.
		 */
		eventId: text('event_id')
			.notNull()
			.references(() => eventListing.id, { onDelete: 'cascade' }),

		status: text('status', { enum: productionStatuses }).notNull().default('draft'),

		/** Who is running the night. Not a capability — the matrix names no such position. */
		producerUserId: text('producer_user_id').references(() => user.id, { onDelete: 'set null' }),

		loadInAt: integer('load_in_at', { mode: 'timestamp' }),
		soundcheckAt: integer('soundcheck_at', { mode: 'timestamp' }),
		firstSetAt: integer('first_set_at', { mode: 'timestamp' }),
		curfewAt: integer('curfew_at', { mode: 'timestamp' }),
		loadOutBy: integer('load_out_by', { mode: 'timestamp' }),

		/** What the acts were told about the money, in the acts' own words. */
		billingNotes: text('billing_notes'),
		/** Green room, food, parking — what the advance promised. */
		hospitalityNotes: text('hospitality_notes'),
		/** Staff-only. Never shown to an act. */
		internalNotes: text('internal_notes'),

		/**
		 * Set-null, unlike `event_listing.createdByUserId` which cascades. Purging
		 * a staff account must not delete the collective's production records; who
		 * opened one is history, not a live reference.
		 */
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// The 1:1, stated by the database rather than by the service remembering.
		// It also serves the join the productions index does on every page load.
		uniqueIndex('uq_production_event').on(t.eventId),
		index('idx_production_status').on(t.status),
		index('idx_production_producer').on(t.producerUserId),
		// Passes on NULL, like every other CHECK here — most productions carry
		// neither time until the advance is under way.
		check(
			'production_curfew_after_first_set',
			sql`curfew_at is null or first_set_at is null or curfew_at > first_set_at`
		)
	]
);

export type Production = typeof production.$inferSelect;
export type NewProduction = typeof production.$inferInsert;

// ---------------------------------------------------------------------------
// Run of show
// ---------------------------------------------------------------------------

/**
 * One act, one set, one position in the running order.
 *
 * The timing and settlement child of `event_band`, 1:1. It carries what a
 * credit cannot answer — how long they play, when they go on, what they need on
 * stage, and what they are paid — while `event_band` stays what its own doc
 * comment says it is: a public credit on a bill.
 *
 * **No `bandProfileId`, no `billing`, no `status`.** Anything that re-declares
 * the act, the running order or the confirmation status is a second answer to a
 * question `event_band` already answers.
 *
 * **Two parents, and both are load-bearing.** `eventBandId` is set-null so a
 * dropped credit leaves the payout record intact — which is exactly why it
 * cannot be the only link: a detached slot would be an orphan nothing could
 * find or delete. `productionId` is the row's home and the predicate every
 * ordered read filters on.
 *
 * See `docs/specs/production-workflow-spec.md` — the 2026-09-07 amendment.
 */
export const productionSlot = sqliteTable(
	'production_slot',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		productionId: text('production_id')
			.notNull()
			.references(() => production.id, { onDelete: 'cascade' }),

		/**
		 * The credit this set belongs to. Null is a slot whose credit came off the
		 * bill, or one that was never on it — a DJ between sets, a host.
		 */
		eventBandId: text('event_band_id').references(() => eventBand.id, { onDelete: 'set null' }),

		/**
		 * Fractional, and deliberately **not** unique.
		 *
		 * SQLite enforces a unique index per-row as an `UPDATE` walks the table and
		 * has no `DEFERRABLE INITIALLY DEFERRED`, so `unique (production_id,
		 * sort_order)` trips mid-statement on any swap — and `db.batch()` controls
		 * atomicity, not constraint timing. Place a slot between two neighbours by
		 * averaging theirs; ties break on `createdAt`. `unique` here looks
		 * obviously correct and is the one thing that breaks reordering, so do not
		 * add it back.
		 */
		sortOrder: real('sort_order').notNull(),

		setLengthMinutes: integer('set_length_minutes').notNull(),
		/** The gap after this set, before the next one starts. */
		changeoverMinutes: integer('changeover_minutes').notNull().default(10),

		/**
		 * Derived output, never hand-edited. Rewritten on every mutation that can
		 * move it. There is no override field, no lock flag and no recalculate
		 * button: a column that is sometimes derived and sometimes not is worse
		 * than one that is always a function of the lineup.
		 */
		scheduledStartAt: integer('scheduled_start_at', { mode: 'timestamp' }),

		/**
		 * Manual, and **not** part of the walk — soundcheck order is frequently the
		 * reverse of set order, and it happens hours earlier.
		 */
		soundcheckAt: integer('soundcheck_at', { mode: 'timestamp' }),

		techNotes: text('tech_notes'),
		backlineNeeds: text('backline_needs'),
		hospitalityNotes: text('hospitality_notes'),

		/** Per-show override of the act's stored contact — a tour manager, a fill-in. */
		contactName: text('contact_name'),
		contactEmail: text('contact_email'),
		contactPhone: text('contact_phone'),

		/**
		 * The deal, per act. `{ guaranteeCents, percentageBps, versus, againstNet }`
		 * subsumes every case CMC has — donated, flat fee, pure split, guarantee
		 * against the door, versus — and `contributed` is the flag that makes a
		 * zero-and-zero a donated set rather than an unfilled row.
		 *
		 * Here rather than on `event_band`, which is a public credit joined by the
		 * gig guide and every band page: about one listing in ten is a CMC show, so
		 * these would be NULL on nine rows in ten of the table the public reads
		 * most. There are no CHECK constraints on them — a CHECK on a populated
		 * table is a rebuild, and the ranges live in the zod schema, which they
		 * have to anyway.
		 */
		guaranteeCents: integer('guarantee_cents'),
		/**
		 * Basis points **of the acts' pool**, not of the door — the pool is already
		 * the acts' 70%, and these divide it among them. A solo act is `10000`.
		 *
		 * They must sum to `10000` across the bill; `setSlotTerms` refuses a share
		 * that overspends, because three acts at 7000 each pays out 210% of a pool
		 * that holds 100% and the overspend comes out of the collective's own cut.
		 * The default is an equal split — CMC has no house headliner/opener split.
		 */
		percentageBps: integer('percentage_bps'),
		/** Guarantee *or* percentage, whichever is greater — rather than both. */
		versus: integer('versus', { mode: 'boolean' }).notNull().default(false),
		/** The percentage applies after expenses rather than to the gross. */
		againstNet: integer('against_net', { mode: 'boolean' }).notNull().default(false),
		/** Zero and zero on purpose: the act played for free, and it was worth this. */
		contributed: integer('contributed', { mode: 'boolean' }).notNull().default(false),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_production_slot_order').on(t.productionId, t.sortOrder),
		// The 1:1 with a credit, stated by the database. Partial, because a
		// production may hold several slots that name no credit at all.
		uniqueIndex('uq_production_slot_event_band')
			.on(t.eventBandId)
			.where(sql`event_band_id is not null`),
		// A zero-length set is a mistake rather than a warning, so it is refused
		// here — which is why `runOfShowWarnings` has no case for it.
		check('production_slot_set_length_positive', sql`set_length_minutes > 0`),
		check('production_slot_changeover_nonneg', sql`changeover_minutes >= 0`)
	]
);

export type ProductionSlot = typeof productionSlot.$inferSelect;
export type NewProductionSlot = typeof productionSlot.$inferInsert;
