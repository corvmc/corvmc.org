import { db } from '#lib/server/db/index.js';
import { contact, type ContactSource } from '#lib/server/db/schema/contact.js';
import { subscriber } from '#lib/server/db/schema/marketing.js';
import { and, asc, eq, gt, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import { CONTACT_CLAIM_RETENTION_DAYS } from '#lib/config.js';
import { requireCapability } from '#lib/server/authorization.js';

/**
 * The **only** module permitted to touch the `contact` table.
 *
 * `custom/no-contact-schema-imports` enforces that, and the boundary is the
 * guardrail rather than a convention: this codebase uses `select()` with no
 * arguments and `getTableColumns()` splats, so a private column on a row a
 * public query touches is one refactor away from being serialized. Reaching this
 * data has to be an explicit act, and this is the only place it can happen.
 *
 * Every export here guards **itself** (an act's contact on `directory.*`, an
 * organization's people on `contact.*`),
 * rather than trusting the caller to have done it. A guard the caller owns is a
 * guard a new caller can forget; a guard the data owns cannot be.
 *
 * Nothing here returns a shape that reaches a client unshaped — the remote layer
 * picks fields explicitly.
 */

export interface ContactData {
	name?: string | null;
	email?: string | null;
	phone?: string | null;
	notes?: string | null;
	paymentRef?: string | null;
	retainUntil?: Date | null;
}

function normalizeEmail(email: string | null | undefined): string | null {
	return email?.toLowerCase().trim() || null;
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
	const normalized = normalizeEmail(email);
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

/** The contact for one party. Needs `directory.readContact`, and the whole row. */
export async function getContact(entryId: string) {
	await requireCapability('directory.readContact');

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
	// The same people who send the act its own sheet, the other route in (#1404).
	await requireCapability('directory.shareContactSheet');
	await writeContact(entryId, data, source);
}

/**
 * The same write, without the staff guard.
 *
 * Exists for `/act/{token}`, which is authorized by a token rather than a
 * session — the act filling in its own contact sheet has no account, and
 * a session guard would refuse the one caller the spec calls the privacy-best
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
	const subscriberId = await linkSubscriber(data.email);

	const [existing] = await db
		.select({ id: contact.id })
		.from(contact)
		.where(eq(contact.entryId, entryId))
		.limit(1);

	const values = {
		name: data.name ?? null,
		email: normalizeEmail(data.email),
		phone: data.phone ?? null,
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
 * Archiving sets a `retainUntil` rather than deleting: the record is why the
 * act was paid what it was paid, and a settlement question can outlive the
 * relationship. `sweepExpiredContacts` removes it once that date passes.
 */
export async function archiveContactForClaim(entryId: string, now = new Date()): Promise<void> {
	const horizon = new Date(now.getTime() + CONTACT_CLAIM_RETENTION_DAYS * 86_400_000);
	await db
		.update(contact)
		.set({ retainUntil: horizon, updatedAt: now })
		.where(eq(contact.entryId, entryId));
}

/** Contacts past their retention horizon, which the next sweep deletes. */
export async function listExpiredContacts(now: Date = new Date()) {
	await requireCapability('directory.readContact');

	return db
		.select({
			id: contact.id,
			entryId: contact.entryId,
			name: contact.name,
			retainUntil: contact.retainUntil
		})
		.from(contact)
		.where(and(eq(contact.source, 'staff_entered'), lte(contact.retainUntil, now)));
}

/**
 * Delete every contact whose `retainUntil` has passed, with its roles (FK
 * cascade). Unguarded: the daily cron runs it with no session. Writes no
 * audit entry, since one naming the person would keep what was deleted.
 */
export async function sweepExpiredContacts(now = new Date()): Promise<{ deleted: number }> {
	const deleted = await db
		.delete(contact)
		.where(lte(contact.retainUntil, now))
		.returning({ id: contact.id });
	return { deleted: deleted.length };
}

/** Whether a party has any contact on file, for a staff list. No details. */
export async function hasContact(entryId: string): Promise<boolean> {
	await requireCapability('directory.readContact');

	const [row] = await db
		.select({ id: contact.id })
		.from(contact)
		.where(and(eq(contact.entryId, entryId), isNull(contact.retainUntil)))
		.limit(1);

	return !!row;
}

// ---------------------------------------------------------------------------
// An organization's people (#2622)
// ---------------------------------------------------------------------------

export type PrimaryContact = {
	id: string;
	name: string | null;
	email: string | null;
	phone: string | null;
};

/** Kept: no horizon, or one still ahead. */
const kept = (now: Date) => or(isNull(contact.retainUntil), gt(contact.retainUntil, now));

/** Earliest first, so the person entered with an organization stays its main one. */
async function peopleAt(organizationIds: string[], now = new Date()) {
	if (organizationIds.length === 0) return [];
	return db
		.select({
			id: contact.id,
			organizationId: contact.organizationId,
			name: contact.name,
			email: contact.email,
			phone: contact.phone
		})
		.from(contact)
		.where(and(inArray(contact.organizationId, organizationIds), kept(now)))
		.orderBy(asc(contact.createdAt), asc(contact.id));
}

/** Each organization's main person: the first one entered and still kept. */
export async function primaryContacts(
	organizationIds: string[]
): Promise<Map<string, PrimaryContact>> {
	await requireCapability('contact.read');
	const out = new Map<string, PrimaryContact>();
	for (const row of await peopleAt(organizationIds)) {
		if (out.has(row.organizationId!)) continue;
		out.set(row.organizationId!, {
			id: row.id,
			name: row.name,
			email: row.email,
			phone: row.phone
		});
	}
	return out;
}

/**
 * Write an organization's main person from its own form. Updates the first
 * person on file, or adds one; all-blank adds nobody. A field left
 * `undefined` keeps what is on file.
 */
export async function setPrimaryContact(
	organizationId: string,
	data: Pick<ContactData, 'name' | 'email' | 'phone'>
): Promise<void> {
	await requireCapability('contact.manage');
	const values = {
		...(data.name !== undefined && { name: data.name || null }),
		...(data.email !== undefined && { email: normalizeEmail(data.email) }),
		...(data.phone !== undefined && { phone: data.phone || null })
	};
	const [existing] = await peopleAt([organizationId]);
	if (!existing && !values.name && !values.email && !values.phone) return;

	// Exact-email auto-merge: someone already on file is reused, never copied.
	const same = !existing && values.email ? await contactByEmail(values.email) : null;
	if (same) {
		await attachExisting(same, organizationId, values);
		return;
	}

	const subscriberId = values.email !== undefined ? await linkSubscriber(values.email) : undefined;
	if (existing) {
		await db
			.update(contact)
			.set({
				...values,
				...(subscriberId !== undefined && { subscriberId }),
				updatedAt: new Date()
			})
			.where(eq(contact.id, existing.id));
		return;
	}
	await db
		.insert(contact)
		.values({ organizationId, ...values, subscriberId, source: 'staff_entered' });
}

/** The contact already holding this address, if any. Addresses are stored normalized. */
async function contactByEmail(email: string, except?: string) {
	const [row] = await db
		.select({
			id: contact.id,
			organizationId: contact.organizationId,
			name: contact.name,
			phone: contact.phone
		})
		.from(contact)
		.where(and(eq(contact.email, email), except ? ne(contact.id, except) : undefined))
		.orderBy(asc(contact.createdAt), asc(contact.id))
		.limit(1);
	return row ?? null;
}

/**
 * Point an existing person at an organization, filling only what they lack.
 * Someone already at another organization keeps it: a shared address is
 * staff's to sort out through the merge suggestions, not this write's.
 */
async function attachExisting(
	same: NonNullable<Awaited<ReturnType<typeof contactByEmail>>>,
	organizationId: string,
	values: { name?: string | null; phone?: string | null }
) {
	await db
		.update(contact)
		.set({
			organizationId: same.organizationId ?? organizationId,
			name: same.name ?? values.name ?? null,
			phone: same.phone ?? values.phone ?? null,
			retainUntil: null,
			updatedAt: new Date()
		})
		.where(eq(contact.id, same.id));
}

export type NewContactInput = {
	organizationId?: string | null;
	name?: string | null;
	role?: string | null;
	email?: string | null;
	phone?: string | null;
	notes?: string | null;
};

/**
 * Add a person. A normalized email already on file attaches to that contact
 * instead (#2622), so the Inbox, the act form and imports never make a second
 * row for one address. Registers a subscriber, never an audience member.
 */
export async function createContact(
	input: NewContactInput,
	source: ContactSource = 'staff_entered'
): Promise<{ id: string; merged: boolean }> {
	await requireCapability('contact.manage');
	const email = normalizeEmail(input.email);
	const same = email ? await contactByEmail(email) : null;
	if (same) {
		if (input.organizationId) await attachExisting(same, input.organizationId, input);
		return { id: same.id, merged: true };
	}
	const subscriberId = await linkSubscriber(email);
	const [row] = await db
		.insert(contact)
		.values({
			organizationId: input.organizationId ?? null,
			name: input.name || null,
			role: input.role || null,
			email,
			phone: input.phone || null,
			notes: input.notes || null,
			subscriberId,
			source
		})
		.returning({ id: contact.id });
	return { id: row.id, merged: false };
}
