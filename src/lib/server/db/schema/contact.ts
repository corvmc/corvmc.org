import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { partyRoles } from '../../../config';
import { subscriber } from './marketing';
import { user } from './authentication';
import { organization } from './party';

/** Who typed this in — the act itself, or staff on their behalf. */
export const contactSources = ['self_entered', 'staff_entered'] as const;
export type ContactSource = (typeof contactSources)[number];

/**
 * A person outside CMC's membership, or a member in an outside capacity: the
 * program officer at a funder, a sponsor's store manager, an act's booker.
 * An act's people sit on its performer organization. See #2622.
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
 *    guards itself. `custom/no-contact-schema-imports` bans
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
		/** Where this person works. Null for a freelancer or a donor giving alone. */
		organizationId: text('organization_id').references(() => organization.id, {
			onDelete: 'set null'
		}),
		/** Set when the person is also a member. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
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
		/** For an act, often a manager rather than a member of it. */
		name: text('name'),
		/** Their job title, such as "program officer". */
		role: text('role'),
		/** Stored lower-cased and trimmed, which is what auto-merge matches on. */
		email: text('email'),
		phone: text('phone'),
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
		index('idx_contact_subscriber').on(t.subscriberId),
		index('idx_contact_organization').on(t.organizationId),
		index('idx_contact_user').on(t.userId),
		index('idx_contact_email').on(t.email),
		// The retention sweep's read: everything with a horizon that has passed.
		index('idx_contact_retain_until').on(t.retainUntil)
	]
);

export type Contact = typeof contact.$inferSelect;

/**
 * What an organization or a person is to CMC. Exactly one owner is set.
 *
 * SQLite cannot check that a `grant_application` names a funder, so the
 * services that write those rows check for the role instead.
 */
export const partyRole = sqliteTable(
	'party_role',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		organizationId: text('organization_id').references(() => organization.id, {
			onDelete: 'cascade'
		}),
		contactId: text('contact_id').references(() => contact.id, { onDelete: 'cascade' }),
		role: text('role', { enum: partyRoles }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('idx_party_role_organization')
			.on(t.organizationId, t.role)
			.where(sql`organization_id is not null`),
		uniqueIndex('idx_party_role_contact')
			.on(t.contactId, t.role)
			.where(sql`contact_id is not null`),
		index('idx_party_role_role').on(t.role),
		check('party_role_one_owner', sql`(organization_id is null) <> (contact_id is null)`)
	]
);

export type PartyRoleRow = typeof partyRole.$inferSelect;
