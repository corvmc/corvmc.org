import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Venues
//
// Where a show is, as a row rather than as a sentence.
//
// `event_listing.location` has carried this since the gig guide shipped, and it stays
// exactly as it is: a band typing "Bombs Away Cafe" into its own listing needs
// no record of the room, and the guide's venue line keeps working unchanged.
// What free text cannot do is answer a question — is this show in our room? —
// and the whole reason that matters is the reservation. `create()` in
// `event-service.ts` holds the practice space only when it is handed a
// reservation, and until now nothing on the record said whether it should be.
// A CMC show at an outside venue therefore asked forever for a room it would
// never hold; the production console admitted as much in a comment.
//
// So this table exists to answer one question first — `isPrimary` — and to give
// the address, the capacity and the load-in notes somewhere to live second.
//
// See `docs/specs/production-workflow-spec.md#venue`.
// ---------------------------------------------------------------------------

export const venue = sqliteTable(
	'venue',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		/**
		 * Deliberately **not** unique.
		 *
		 * A uniqueness constraint on a human-entered name turns an ordinary
		 * data-entry situation into a 500 and a Sentry report, and there is no
		 * reason two rooms in two towns cannot share a name. `slug` carries
		 * uniqueness, and `ensureUniqueSlug()` already handles collisions.
		 */
		name: text('name').notNull(),
		slug: text('slug').notNull(),

		/**
		 * The practice room. Exactly one row should carry it, enforced by a partial
		 * unique index rather than by convention.
		 *
		 * This is the load-bearing column: an event at the primary venue holds the
		 * space and an event anywhere else does not, which is the difference the
		 * free-text `location` could never express.
		 */
		isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),

		address1: text('address1'),
		city: text('city'),
		state: text('state'),
		postalCode: text('postal_code'),
		capacity: integer('capacity'),

		contactName: text('contact_name'),
		contactEmail: text('contact_email'),
		contactPhone: text('contact_phone'),

		/** Where the van goes, which door is unlocked, who has the key. */
		loadInNotes: text('load_in_notes'),
		notes: text('notes'),

		// Soft delete, matching every other directory-ish table: an event that
		// happened at a venue keeps naming it after the venue closes.
		deletedAt: integer('deleted_at', { mode: 'timestamp' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('venue_slug_idx').on(t.slug),
		index('venue_name_idx').on(t.name),
		// One primary room, and the database says so rather than the service
		// remembering to. Partial, so every other venue is free to be false.
		uniqueIndex('venue_one_primary_idx')
			.on(t.isPrimary)
			.where(sql`is_primary = 1`),
		check('venue_capacity_positive', sql`capacity is null or capacity > 0`)
	]
);

export type Venue = typeof venue.$inferSelect;
export type NewVenue = typeof venue.$inferInsert;
