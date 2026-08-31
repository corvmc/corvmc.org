import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { directoryEntry } from './directory';
import { subscriber } from './marketing';

/** Who typed this in — the act itself, or staff on their behalf. */
export const contactSources = ['self_entered', 'staff_entered'] as const;
export type ContactSource = (typeof contactSources)[number];

/**
 * The private half of a party record. Phase 10 of `docs/specs/groups-spec.md`.
 *
 * `directory_entry` is a **public** listing; an external act's booking details
 * are the opposite of public, and the two must not share a row.
 *
 * **A separate table is the protection that actually works.** This codebase uses
 * `select()` with no arguments and `getTableColumns()` splats; any private
 * column sitting on a row a public query touches is one refactor away from being
 * serialized. Putting the fields in their own table makes leaking require an
 * explicit JOIN — something a person has to mean.
 *
 * Three rules ride on top of it, and only the first is enforceable by the
 * schema's shape alone:
 *
 * 1. **One access path.** Every read goes through `contact-service.ts`, which
 *    calls `requireStaff()` itself. `custom/no-contact-schema-imports` bans
 *    importing this module anywhere else.
 * 2. **Never in a client DTO.** Remote functions return a shaped object; these
 *    fields appear in exactly one staff-facing query.
 * 3. **Prefer self-entered.** `/act/{token}` is the privacy-best acquisition
 *    path — the act types its own details, so CMC holds what they chose to give.
 *    `source` records which rows someone actually consented to, and
 *    staff-typed is the fallback rather than the default.
 */
export const contact = sqliteTable(
	'contact',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		/**
		 * The party this describes. Nullable so a contact can outlive the listing
		 * it was attached to — but `cascade`, so deleting the entry does take it,
		 * which is the behaviour that matters for a deletion request.
		 */
		entryId: text('entry_id').references(() => directoryEntry.id, { onDelete: 'cascade' }),
		/**
		 * The consent ledger for this address, if it is registered.
		 *
		 * `subscriber` and `contact` answer different questions — "may we email
		 * this" versus "who is this and what do we owe them" — which is why they
		 * stay apart. The link is what makes sure the first has exactly **one**
		 * answer: without it a future "email the booking contact" path would read
		 * an address off this table and silently bypass a suppression the person
		 * actually expressed.
		 *
		 * The corollary is a rule the service enforces: creating a contact may
		 * create a `subscriber` row, and must **never** create an `audience_member`
		 * row. Registering an address in the ledger is bookkeeping; enrolling it in
		 * a list without opt-in is how a sending domain collects spam complaints.
		 */
		subscriberId: text('subscriber_id').references(() => subscriber.id, { onDelete: 'set null' }),
		/** Often a manager rather than a member of the act. */
		bookingName: text('booking_name'),
		bookingEmail: text('booking_email'),
		bookingPhone: text('booking_phone'),
		notes: text('notes'),
		/** A Stripe or settlement reference. Never card data. */
		paymentRef: text('payment_ref'),
		source: text('source', { enum: contactSources }).notNull(),
		/**
		 * When this stops being worth keeping.
		 *
		 * Marketing material, payment rectification and lost gear all have a
		 * natural horizon. Nothing expires automatically yet — that is the current
		 * gap rather than a decision — but the horizon is recorded so a staff
		 * report can list contacts with no event in N years, and so claiming an act
		 * has somewhere to write "this is retired now".
		 */
		retainUntil: integer('retain_until', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_contact_entry').on(t.entryId),
		index('idx_contact_subscriber').on(t.subscriberId),
		// The retention sweep's read: everything with a horizon that has passed.
		index('idx_contact_retain_until').on(t.retainUntil)
	]
);

export type Contact = typeof contact.$inferSelect;
