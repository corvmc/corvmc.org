import { db } from '$lib/server/db';
import { contact, type ContactSource } from '$lib/server/db/schema/contact';
import { subscriber } from '$lib/server/db/schema/marketing';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { requireStaff } from '$lib/server/authorization';

/**
 * The **only** module permitted to touch the `contact` table.
 *
 * `custom/no-contact-schema-imports` enforces that, and the boundary is the
 * guardrail rather than a convention: this codebase uses `select()` with no
 * arguments and `getTableColumns()` splats, so a private column on a row a
 * public query touches is one refactor away from being serialized. Reaching this
 * data has to be an explicit act, and this is the only place it can happen.
 *
 * Every export here calls `requireStaff()` **itself**, rather than trusting the
 * caller to have done it. A guard the caller owns is a guard a new caller can
 * forget; a guard the data owns cannot be.
 *
 * Nothing here returns a shape that reaches a client unshaped — the remote layer
 * picks fields explicitly.
 */

export interface ContactData {
	bookingName?: string | null;
	bookingEmail?: string | null;
	bookingPhone?: string | null;
	notes?: string | null;
	paymentRef?: string | null;
	retainUntil?: Date | null;
}

/**
 * Register an address in the consent ledger, and return its id.
 *
 * **Creates a `subscriber` row and never an `audience_member` row.** Registering
 * an address is bookkeeping — it is what makes "may we email this person" have
 * exactly one answer, so a later "email the booking contact" path cannot bypass
 * a suppression the person expressed. Enrolling that address in a list without
 * opt-in is a different act entirely, and it is how a sending domain collects
 * spam complaints. `audience.allowOptIn` already draws that line; this does not
 * cross it.
 *
 * An address already in the ledger is reused rather than duplicated, suppression
 * and all — `subscriber.email` is unique, which is what makes that safe.
 */
async function linkSubscriber(email: string | null | undefined): Promise<string | null> {
	const normalized = email?.toLowerCase().trim();
	if (!normalized) return null;

	const [existing] = await db
		.select({ id: subscriber.id })
		.from(subscriber)
		.where(eq(subscriber.email, normalized))
		.limit(1);
	if (existing) return existing.id;

	const [row] = await db
		.insert(subscriber)
		.values({ email: normalized })
		.returning({ id: subscriber.id });
	return row.id;
}

/** The contact for one party. Staff-only, and the whole row. */
export async function getContact(entryId: string) {
	await requireStaff();

	const [row] = await db.select().from(contact).where(eq(contact.entryId, entryId)).limit(1);

	return row ?? null;
}

/**
 * Write the booking details for a party.
 *
 * `source` is not a parameter a caller chooses freely — it records whether the
 * act typed this itself or staff typed it on their behalf, which is a fact about
 * the acquisition path rather than a setting. `/act/{token}` passes
 * `'self_entered'`; every staff path passes `'staff_entered'`.
 */
export async function upsertContact(
	entryId: string,
	data: ContactData,
	source: ContactSource
): Promise<void> {
	await requireStaff();
	await writeContact(entryId, data, source);
}

/**
 * The same write, without the staff guard.
 *
 * Exists for `/act/{token}`, which is authorized by a token rather than a
 * session — the act filling in its own contact sheet has no account, and
 * `requireStaff()` would refuse the one caller the spec calls the privacy-best
 * acquisition path. Not exported beyond this module's own callers by accident:
 * it is exported deliberately and named so that reaching for it looks like what
 * it is.
 */
export async function writeContactUnguarded(
	entryId: string,
	data: ContactData,
	source: ContactSource
): Promise<void> {
	await writeContact(entryId, data, source);
}

async function writeContact(
	entryId: string,
	data: ContactData,
	source: ContactSource
): Promise<void> {
	const subscriberId = await linkSubscriber(data.bookingEmail);

	const [existing] = await db
		.select({ id: contact.id })
		.from(contact)
		.where(eq(contact.entryId, entryId))
		.limit(1);

	const values = {
		bookingName: data.bookingName ?? null,
		bookingEmail: data.bookingEmail?.toLowerCase().trim() || null,
		bookingPhone: data.bookingPhone ?? null,
		notes: data.notes ?? null,
		paymentRef: data.paymentRef ?? null,
		retainUntil: data.retainUntil ?? null,
		subscriberId,
		source
	};

	if (existing) {
		await db
			.update(contact)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(contact.id, existing.id));
		return;
	}

	await db.insert(contact).values({ entryId, ...values });
}

/**
 * Retire a contact when its act becomes a CMC band.
 *
 * **Archived, not inherited.** The booking contact is frequently a manager
 * rather than one of the members who just joined, so carrying it forward would
 * leave a member band holding a stale private phone number that nobody owns.
 * Contact then goes through the account.
 *
 * Archiving is a `retainUntil` in the past rather than a delete: the record is
 * why the act was paid what it was paid, and a settlement question can outlive
 * the relationship. The retention sweep is what eventually removes it.
 */
export async function archiveContactForClaim(entryId: string): Promise<void> {
	await db
		.update(contact)
		.set({ retainUntil: new Date(), updatedAt: new Date() })
		.where(eq(contact.entryId, entryId));
}

/**
 * Contacts past their retention horizon.
 *
 * Nothing deletes them yet — the sweep is the gap the spec names — but the read
 * exists so a staff report can show what is due, which is the difference between
 * a horizon that is recorded and one that is enforced.
 */
export async function listExpiredContacts(now: Date = new Date()) {
	await requireStaff();

	return db
		.select({
			id: contact.id,
			entryId: contact.entryId,
			bookingName: contact.bookingName,
			retainUntil: contact.retainUntil
		})
		.from(contact)
		.where(and(eq(contact.source, 'staff_entered'), lte(contact.retainUntil, now)));
}

/** Whether a party has any contact on file, for a staff list. No details. */
export async function hasContact(entryId: string): Promise<boolean> {
	await requireStaff();

	const [row] = await db
		.select({ id: contact.id })
		.from(contact)
		.where(and(eq(contact.entryId, entryId), isNull(contact.retainUntil)))
		.limit(1);

	return !!row;
}
