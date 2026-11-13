import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { emailBlocklist, type EmailBlocklistEntry } from '#lib/server/db/schema/moderation.js';
import { subscriber } from '#lib/server/db/schema/marketing.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { DomainError } from '#lib/server/domain-error.js';
import { BLOCKLIST_NOTE_MAX, type BlocklistSource } from '#lib/config.js';

export class BlocklistEntryNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Blocklist entry not found');
	}
}

export function normalizeBlocklistEmail(email: string): string {
	return email.toLowerCase().trim();
}

/** The entry refusing this address, or null. Read by the sign-up hook. */
export async function findBlockedEmail(email: string): Promise<EmailBlocklistEntry | null> {
	const [row] = await db
		.select()
		.from(emailBlocklist)
		.where(eq(emailBlocklist.email, normalizeBlocklistEmail(email)))
		.limit(1);
	return row ?? null;
}

/** Counts a refused sign-up on the entry, which is all staff see of it. */
export async function recordRefusedSignup(entryId: string, now = new Date()): Promise<void> {
	await db
		.update(emailBlocklist)
		.set({ refusedCount: sql`${emailBlocklist.refusedCount} + 1`, lastRefusedAt: now })
		.where(eq(emailBlocklist.id, entryId));
}

/**
 * Block an address from creating an account. Idempotent: an address already
 * listed keeps its first entry. A matching subscriber that is still deliverable
 * is suppressed as `blocked`; a bounce or complaint already recorded is kept.
 * Sign-in is never checked against this list, so an existing member's login is
 * untouched — only a removal does that.
 */
export async function blockEmail(params: {
	email: string;
	source: BlocklistSource;
	addedByUserId: string | null;
	note?: string | null;
	removalId?: string | null;
}): Promise<string> {
	const email = normalizeBlocklistEmail(params.email);
	await db
		.insert(emailBlocklist)
		.values({
			email,
			source: params.source,
			note: params.note ? params.note.slice(0, BLOCKLIST_NOTE_MAX) : null,
			removalId: params.removalId ?? null,
			addedByUserId: params.addedByUserId
		})
		.onConflictDoNothing({ target: emailBlocklist.email });
	const [entry] = await db
		.select({ id: emailBlocklist.id })
		.from(emailBlocklist)
		.where(eq(emailBlocklist.email, email));
	await db
		.update(subscriber)
		.set({ suppressedAt: new Date(), suppressionReason: 'blocked' })
		.where(and(eq(subscriber.email, email), isNull(subscriber.suppressedAt)));
	return entry.id;
}

/** Remove an entry and the `blocked` suppression it caused, if any. */
export async function unblockEmail(entryId: string): Promise<string> {
	const [row] = await db
		.delete(emailBlocklist)
		.where(eq(emailBlocklist.id, entryId))
		.returning({ email: emailBlocklist.email });
	if (!row) throw new BlocklistEntryNotFoundError();
	await clearBlockedSuppression(row.email);
	return row.email;
}

/** Lifting a ban unblocks the address the ban added, and only that one. */
export async function unblockForRemoval(removalId: string): Promise<void> {
	const rows = await db
		.delete(emailBlocklist)
		.where(and(eq(emailBlocklist.removalId, removalId), eq(emailBlocklist.source, 'ban')))
		.returning({ email: emailBlocklist.email });
	for (const row of rows) await clearBlockedSuppression(row.email);
}

async function clearBlockedSuppression(email: string): Promise<void> {
	await db
		.update(subscriber)
		.set({ suppressedAt: null, suppressionReason: null })
		.where(and(eq(subscriber.email, email), eq(subscriber.suppressionReason, 'blocked')));
}

export interface BlocklistRow extends EmailBlocklistEntry {
	addedByName: string | null;
}

export async function listBlocklist(): Promise<BlocklistRow[]> {
	return db
		.select({
			id: emailBlocklist.id,
			email: emailBlocklist.email,
			source: emailBlocklist.source,
			note: emailBlocklist.note,
			removalId: emailBlocklist.removalId,
			addedByUserId: emailBlocklist.addedByUserId,
			refusedCount: emailBlocklist.refusedCount,
			lastRefusedAt: emailBlocklist.lastRefusedAt,
			createdAt: emailBlocklist.createdAt,
			addedByName: user.name
		})
		.from(emailBlocklist)
		.leftJoin(user, eq(user.id, emailBlocklist.addedByUserId))
		.orderBy(desc(emailBlocklist.createdAt));
}
