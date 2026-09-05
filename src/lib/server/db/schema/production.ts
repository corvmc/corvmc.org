import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { eventListing } from './event';
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
// pool is `sum(ticket.acts_cents)` and the deal lives on `event_band`; adding
// columns nothing reads is how a table starts lying about what it holds.
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
