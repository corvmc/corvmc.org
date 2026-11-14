import { db } from '#lib/server/db/index.js';
import { contact, partyRole, type ContactSource } from '#lib/server/db/schema/contact.js';
import { DomainError } from '#lib/server/domain-error.js';
import { subscriber } from '#lib/server/db/schema/marketing.js';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { CONTACT_CLAIM_RETENTION_DAYS, type PartyRole } from '#lib/config.js';
import { can, requireCapability } from '#lib/server/authorization.js';
import { organization } from '#lib/server/db/schema/party.js';
import { productionSlot } from '#lib/server/db/schema/production.js';
import { copyLinks } from '#lib/server/task/work-order-link.js';
import { moveActivity } from '#lib/server/party/activity-service.js';
import { moveThreads } from '#lib/server/party/thread-filing.js';
import { nameKey } from '#lib/server/party/party-key.js';

/**
 * The **only** module permitted to touch the `contact` table.
 *
 * `custom/no-contact-schema-imports` enforces that, and the boundary is the
 * guardrail rather than a convention: this codebase uses `select()` with no
 * arguments and `getTableColumns()` splats, so a private column on a row a
 * public query touches is one refactor away from being serialized. Reaching this
 * data has to be an explicit act, and this is the only place it can happen.
 *
 * Every export here guards **itself** (an act's people on `directory.*`, an
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

	// A no-op update on the unique email, so the insert and the reuse are one
	// statement and a concurrent caller gets the same row back.
	const [row] = await db
		.insert(subscriber)
		.values({ email: normalized })
		.onConflictDoUpdate({ target: subscriber.email, set: { email: sql`${subscriber.email}` } })
		.returning({ id: subscriber.id });
	return row.id;
}

/**
 * What an act typed on `/act/{token}`, written as one of its people.
 *
 * Unguarded: the act has no session, and the token was resolved by the caller.
 * Named so that reaching for it looks like what it is. A normalized email
 * already on file updates that contact, which keeps its organization (a shared
 * address is staff's to sort out). Without an email, the act's own earlier
 * entry with no address is updated, so saving the sheet twice adds nobody.
 */
export async function writeActContactUnguarded(
	organizationId: string,
	data: ContactData
): Promise<void> {
	const email = normalizeEmail(data.email);
	const name = data.name?.trim() || null;
	const phone = data.phone?.trim() || null;
	if (!email && !name && !phone) return;

	let same = email ? await contactByEmail(email) : await unaddressedSelfEntry(organizationId);
	if (!same) {
		const [row] = await db
			.insert(contact)
			.values({
				organizationId,
				name,
				email,
				phone,
				subscriberId: await linkSubscriber(email),
				source: 'self_entered'
			})
			.returning({ id: contact.id });
		if (email) return;
		// No unique key: an org merge or an edit may leave two unaddressed
		// entries. So two saves that both read nothing collapse after inserting:
		// the earliest wins, and the later deletes its own row and updates it.
		const first = await unaddressedSelfEntry(organizationId);
		if (!first || first.id === row.id) return;
		await db.delete(contact).where(eq(contact.id, row.id));
		same = first;
	}
	await db
		.update(contact)
		.set({
			organizationId: same.organizationId ?? organizationId,
			...(name && { name }),
			...(phone && { phone }),
			retainUntil: null,
			updatedAt: new Date()
		})
		.where(eq(contact.id, same.id));
}

async function unaddressedSelfEntry(organizationId: string) {
	const [row] = await db
		.select({ id: contact.id, organizationId: contact.organizationId })
		.from(contact)
		.where(
			and(
				eq(contact.organizationId, organizationId),
				eq(contact.source, 'self_entered'),
				isNull(contact.email)
			)
		)
		.orderBy(sql`rowid`)
		.limit(1);
	return row ?? null;
}

/**
 * Retire an act's people when it becomes a CMC band.
 *
 * **Archived, not inherited.** The booking contact is frequently a manager
 * rather than one of the members who just joined. A `retainUntil` a year out
 * rather than a delete: the record is why the act was paid what it was paid,
 * and `sweepExpiredContacts` removes it once that date passes. Unguarded: it
 * runs inside the already-guarded claim.
 */
export async function archiveActContactsForClaim(
	organizationId: string,
	now = new Date()
): Promise<void> {
	const horizon = new Date(now.getTime() + CONTACT_CLAIM_RETENTION_DAYS * 86_400_000);
	await db
		.update(contact)
		.set({ retainUntil: horizon, updatedAt: now })
		.where(and(eq(contact.organizationId, organizationId), isNull(contact.retainUntil)));
}

export type ActContact = {
	id: string;
	organizationId: string;
	name: string | null;
	email: string | null;
	phone: string | null;
};

/**
 * The kept people at each act, for picking a show's contact. Open to whoever
 * books or runs that show's project, and otherwise to `directory.readContact`.
 */
export async function listActContacts(
	organizationIds: string[],
	projectId: string | null
): Promise<ActContact[]> {
	const booker =
		!!projectId &&
		((await can('production.book', { projectId })) || (await can('production.run', { projectId })));
	if (!booker) await requireCapability('directory.readContact');
	const rows = await peopleAt(organizationIds);
	return rows.map((r) => ({ ...r, organizationId: r.organizationId! }));
}

/**
 * Names of a show's contacts, for the act on `/act/{token}`.
 *
 * Unguarded for the same reason as `writeActContactUnguarded`: the caller
 * resolved the token. Only people kept at that act's own performer
 * organization come back, whatever ids are passed.
 */
export async function actContactNamesUnguarded(
	entryId: string,
	contactIds: string[]
): Promise<Map<string, string | null>> {
	if (contactIds.length === 0) return new Map();
	const rows = await db
		.select({ id: contact.id, name: contact.name })
		.from(contact)
		.innerJoin(organization, eq(organization.id, contact.organizationId))
		.where(
			and(
				inArray(contact.id, contactIds),
				eq(organization.directoryEntryId, entryId),
				kept(new Date())
			)
		);
	return new Map(rows.map((r) => [r.id, r.name]));
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
	return primaryContactsUnguarded(organizationIds);
}

/** `primaryContacts` for a sender that addresses mail, not a viewer. Callers guard. */
export async function primaryContactsUnguarded(
	organizationIds: string[]
): Promise<Map<string, PrimaryContact>> {
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

/** Every organization's main person, read in one pass rather than bound per id. */
export async function allPrimaryContacts(): Promise<Map<string, PrimaryContact>> {
	await requireCapability('contact.read');
	const out = new Map<string, PrimaryContact>();
	const rows = await db
		.select({
			id: contact.id,
			organizationId: contact.organizationId,
			name: contact.name,
			email: contact.email,
			phone: contact.phone
		})
		.from(contact)
		.where(and(isNotNull(contact.organizationId), kept(new Date())))
		.orderBy(asc(contact.createdAt), asc(contact.id));
	for (const { organizationId, ...person } of rows) {
		if (!out.has(organizationId!)) out.set(organizationId!, person);
	}
	return out;
}

/** Kept people with no organization, such as a donor giving alone, with their roles. */
export async function listUnaffiliatedPeople() {
	await requireCapability('contact.read');
	const [rows, roles] = await Promise.all([
		db
			.select({ id: contact.id, name: contact.name, email: contact.email })
			.from(contact)
			.where(and(isNull(contact.organizationId), kept(new Date()))),
		db
			.select({ contactId: partyRole.contactId, role: partyRole.role })
			.from(partyRole)
			.where(isNotNull(partyRole.contactId))
	]);
	const held = new Map<string, PartyRole[]>();
	for (const r of roles) held.set(r.contactId!, [...(held.get(r.contactId!) ?? []), r.role]);
	return rows.map((r) => ({ ...r, roles: held.get(r.id) ?? [] }));
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
/**
 * Someone applying from a public form, such as a market vendor: their
 * organization, found through a contact already holding the email, else
 * created under `organizationName`, and given `role`. Unguarded, like
 * `writeContactUnguarded`: the caller is a public form with no session, and
 * nothing it returns is a contact detail.
 */
export async function recordApplicantUnguarded(input: {
	organizationName: string;
	role: PartyRole;
	name: string;
	email: string;
	phone?: string | null;
}): Promise<{ organizationId: string; contactId: string }> {
	const email = normalizeEmail(input.email);
	if (!email) throw new Error('An applicant needs an email');
	const same = await contactByEmail(email);
	let organizationId = same?.organizationId ?? null;
	if (!organizationId) {
		const [org] = await db
			.insert(organization)
			.values({ name: input.organizationName.trim() })
			.returning({ id: organization.id });
		organizationId = org.id;
	}
	let contactId: string;
	if (same) {
		await attachExisting(same, organizationId, input);
		contactId = same.id;
	} else {
		const [row] = await db
			.insert(contact)
			.values({
				organizationId,
				name: input.name.trim() || null,
				email,
				phone: input.phone?.trim() || null,
				subscriberId: await linkSubscriber(email),
				source: 'self_entered'
			})
			.returning({ id: contact.id });
		contactId = row.id;
	}
	await db.insert(partyRole).values({ organizationId, role: input.role }).onConflictDoNothing();
	return { organizationId, contactId };
}

// ---------------------------------------------------------------------------
// The Contacts screens (#2622)
// ---------------------------------------------------------------------------

export class ContactNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Contact not found');
	}
}

export class ContactMergeError extends DomainError {
	readonly httpStatus = 422;
	constructor() {
		super('Pick two different people to merge.');
	}
}

const personColumns = {
	id: contact.id,
	organizationId: contact.organizationId,
	name: contact.name,
	role: contact.role,
	email: contact.email,
	phone: contact.phone,
	notes: contact.notes,
	source: contact.source
};

/** One kept person, with the organization they are at. */
export async function getPerson(id: string) {
	await requireCapability('contact.read');
	const [row] = await db
		.select({ ...personColumns, organizationName: organization.name })
		.from(contact)
		.leftJoin(organization, eq(organization.id, contact.organizationId))
		.where(and(eq(contact.id, id), kept(new Date())))
		.limit(1);
	if (!row) throw new ContactNotFoundError();
	const roles = await db
		.select({ role: partyRole.role })
		.from(partyRole)
		.where(eq(partyRole.contactId, id));
	return { ...row, roles: roles.map((r) => r.role) };
}

/** The kept person holding an address, with their organization: an Inbox filing suggestion. */
export async function findPersonByEmail(email: string | null | undefined) {
	await requireCapability('contact.read');
	const normalized = normalizeEmail(email);
	if (!normalized) return null;
	const [row] = await db
		.select({
			id: contact.id,
			name: contact.name,
			organizationId: contact.organizationId,
			organizationName: organization.name
		})
		.from(contact)
		.leftJoin(organization, eq(organization.id, contact.organizationId))
		.where(and(eq(contact.email, normalized), kept(new Date())))
		.orderBy(asc(contact.createdAt), asc(contact.id))
		.limit(1);
	return row ?? null;
}

/** Every person row at an organization, kept or not. Callers guard. */
export async function countOrganizationPeopleUnguarded(organizationId: string): Promise<number> {
	const rows = await db
		.select({ id: contact.id })
		.from(contact)
		.where(eq(contact.organizationId, organizationId));
	return rows.length;
}

/** The subscriber rows of a person, or of everyone kept at an organization, as a subquery. Callers guard. */
export function partySubscribersUnguarded(party: { type: 'organization' | 'contact'; id: string }) {
	return db
		.select({ id: contact.subscriberId })
		.from(contact)
		.where(
			and(
				party.type === 'contact' ? eq(contact.id, party.id) : eq(contact.organizationId, party.id),
				isNotNull(contact.subscriberId),
				kept(new Date())
			)
		);
}

/** Everyone kept at an organization, the main person first. */
export async function listPeople(organizationId: string) {
	await requireCapability('contact.read');
	return db
		.select(personColumns)
		.from(contact)
		.where(and(eq(contact.organizationId, organizationId), kept(new Date())))
		.orderBy(asc(contact.createdAt), asc(contact.id));
}

export async function updateContact(
	id: string,
	input: Omit<NewContactInput, 'organizationId'>
): Promise<void> {
	await requireCapability('contact.manage');
	const email = normalizeEmail(input.email);
	const rows = await db
		.update(contact)
		.set({
			name: input.name || null,
			role: input.role || null,
			email,
			phone: input.phone || null,
			notes: input.notes || null,
			subscriberId: await linkSubscriber(email),
			updatedAt: new Date()
		})
		.where(eq(contact.id, id))
		.returning({ id: contact.id });
	if (rows.length === 0) throw new ContactNotFoundError();
}

/** Delete a person outright, with their roles. */
export async function deleteContact(id: string): Promise<void> {
	await requireCapability('contact.manage');
	const rows = await db.delete(contact).where(eq(contact.id, id)).returning({ id: contact.id });
	if (rows.length === 0) throw new ContactNotFoundError();
}

/** Move everyone at one organization to another, for an organization merge. */
export async function moveOrganizationPeople(fromId: string, toId: string): Promise<void> {
	await requireCapability('contact.manage');
	await db
		.update(contact)
		.set({ organizationId: toId, updatedAt: new Date() })
		.where(eq(contact.organizationId, fromId));
}

export type ContactSuggestion = {
	reason: 'name' | 'phone';
	people: {
		id: string;
		name: string | null;
		email: string | null;
		organizationId: string | null;
	}[];
};

const digits = (phone: string) => phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

/**
 * People who are likely one person: the same name, or the same phone number.
 * Suggested, never merged on their own: a shared `info@` or front-desk number
 * belongs to an organization, not a person.
 */
export async function listContactMergeSuggestions(): Promise<ContactSuggestion[]> {
	await requireCapability('contact.read');
	const rows = await db
		.select(personColumns)
		.from(contact)
		.where(kept(new Date()))
		.orderBy(asc(contact.createdAt), asc(contact.id));

	const groups = new Map<string, ContactSuggestion>();
	const add = (reason: ContactSuggestion['reason'], key: string, r: (typeof rows)[number]) => {
		const k = `${reason}:${key}`;
		const g = groups.get(k) ?? { reason, people: [] };
		g.people.push({
			id: r.id,
			name: r.name,
			email: r.email,
			organizationId: r.organizationId
		});
		groups.set(k, g);
	};
	for (const r of rows) {
		const name = nameKey(r.name);
		if (name) add('name', name, r);
		const phone = r.phone ? digits(r.phone) : '';
		if (phone.length >= 7) add('phone', phone, r);
	}
	return [...groups.values()].filter((g) => g.people.length > 1);
}

/**
 * Fold `otherId` into `survivorId`: its roles move over, its blanks are filled,
 * the rest of its details are kept as a note, and it is deleted. Returns the
 * survivor's name, for the audit entry the remote writes.
 */
export async function mergeContacts(survivorId: string, otherId: string): Promise<string | null> {
	await requireCapability('contact.manage');
	if (survivorId === otherId) throw new ContactMergeError();
	const found = await db
		.select({
			...personColumns,
			subscriberId: contact.subscriberId,
			userId: contact.userId
		})
		.from(contact)
		.where(inArray(contact.id, [survivorId, otherId]));
	const survivor = found.find((r) => r.id === survivorId);
	const other = found.find((r) => r.id === otherId);
	if (!survivor || !other) throw new ContactNotFoundError();

	const roles = await db
		.select({ role: partyRole.role })
		.from(partyRole)
		.where(eq(partyRole.contactId, otherId));
	const details = [other.name, other.role, other.email, other.phone].filter(Boolean).join(' · ');
	const notes = [survivor.notes, other.notes, details && `Merged from ${details}`]
		.filter(Boolean)
		.join('\n');

	await db.batch([
		db
			.update(contact)
			.set({
				organizationId: survivor.organizationId ?? other.organizationId,
				userId: survivor.userId ?? other.userId,
				name: survivor.name ?? other.name,
				role: survivor.role ?? other.role,
				email: survivor.email ?? other.email,
				phone: survivor.phone ?? other.phone,
				subscriberId: survivor.subscriberId ?? other.subscriberId,
				notes: notes || null,
				updatedAt: new Date()
			})
			.where(eq(contact.id, survivorId)),
		...roles.map((r) =>
			db.insert(partyRole).values({ contactId: survivorId, role: r.role }).onConflictDoNothing()
		),
		// Their tasks and notes come too; the delete below takes the old links.
		copyLinks('contactId', otherId, survivorId),
		moveActivity({ type: 'contact', id: otherId }, { type: 'contact', id: survivorId }),
		moveThreads({ type: 'contact', id: otherId }, { type: 'contact', id: survivorId }),
		// A show that named them as its contact names the survivor.
		db
			.update(productionSlot)
			.set({ contactId: survivorId })
			.where(eq(productionSlot.contactId, otherId)),
		db.delete(contact).where(eq(contact.id, otherId))
	]);
	return survivor.name ?? other.name;
}
