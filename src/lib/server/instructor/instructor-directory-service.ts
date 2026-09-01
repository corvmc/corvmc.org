import { and, asc, eq, isNull, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { instructor } from '$lib/server/db/schema/instructor';
import { user } from '$lib/server/db/schema/authentication';
import { directoryEntry, directoryTag } from '$lib/server/db/schema/directory';
import { contactForView } from '$lib/utils/directory-display';
import type { DirectoryContact } from '$lib/server/db/schema/authentication';

/**
 * The public-facing half of the instructor module: who teaches here, and how to
 * reach them.
 *
 * **Three gates, and all three are exposure risks.** This is the only part of
 * the module where a mistake publishes somebody who did not consent, which is
 * why they are in one function with one test file rather than spread across the
 * routes that call it.
 *
 * 1. `status = 'active'` — an unapproved applicant's draft listing is a real
 *    listing sitting in a real table, one missing predicate from the public
 *    page. This is the gate that stops it.
 * 2. `directory_entry.visibility` — a member who hid their directory listing
 *    must not be surfaced by a second one.
 * 3. `contactForView` over the **resolved** contact, fallback included. A
 *    members-only contact must not become public by being reached through a
 *    null `teachingContact`.
 *
 * And a fourth thing that is a whitelist rather than a gate: the returned shape
 * is written out field by field, so `applicationNote` — staff-only — cannot
 * reach a listing by someone adding a column later. Same rule
 * `toPublicMemberProfile` states: fields are listed explicitly "so a newly added
 * column never leaks by default".
 */

export interface InstructorListing {
	userId: string;
	name: string;
	pronouns: string | null;
	image: string | null;
	headline: string | null;
	blurb: string | null;
	ratesNote: string | null;
	bookingUrl: string | null;
	instruments: string[];
	/** Already gated. Null means "withheld or absent", and the card must not care which. */
	contact: DirectoryContact | null;
	/** True when the contact was withheld rather than never set — drives the owner's nudge only. */
	contactWithheld: boolean;
}

export interface InstructorFilters {
	search?: string;
	instrument?: string;
}

export async function listInstructors(
	visibility: 'members' | 'public',
	filters?: InstructorFilters
): Promise<InstructorListing[]> {
	const conditions = [
		// Gate 1.
		eq(instructor.status, 'active'),
		// An instructor with a full book is not listed, but keeps booking. Their
		// own switch, distinct from staff pausing them.
		eq(instructor.acceptingStudents, true),
		// Gate 2, in three parts: the entry must exist, not be soft-deleted, and
		// be visible to this viewer.
		isNull(directoryEntry.deletedAt),
		isNull(user.deletedAt),
		visibility === 'public'
			? eq(directoryEntry.visibility, 'public')
			: inArray(directoryEntry.visibility, ['members', 'public'])
	];

	if (filters?.search) {
		conditions.push(sql`lower(${user.name}) like ${'%' + filters.search.toLowerCase() + '%'}`);
	}

	if (filters?.instrument) {
		conditions.push(
			sql`exists (select 1 from ${directoryTag} t
			            where t.entry_id = ${directoryEntry.id}
			              and t.kind = 'instrument'
			              and t.value = ${filters.instrument})`
		);
	}

	const rows = await db
		.select({
			entryId: directoryEntry.id,
			userId: user.id,
			name: user.name,
			pronouns: user.pronouns,
			image: user.image,
			headline: instructor.headline,
			blurb: instructor.blurb,
			ratesNote: instructor.ratesNote,
			bookingUrl: instructor.bookingUrl,
			teachingContact: instructor.teachingContact,
			entryContact: directoryEntry.contact
		})
		.from(instructor)
		.innerJoin(user, eq(user.id, instructor.userId))
		// Inner join: no directory entry means nothing to list. An instructor
		// without one is a real state — the grant does not create an entry — and
		// they simply do not appear until they have a profile.
		.innerJoin(directoryEntry, eq(directoryEntry.userId, user.id))
		.where(and(...conditions))
		.orderBy(asc(user.name));

	if (rows.length === 0) return [];

	// One query for every listing's instruments rather than one per row.
	const tags = await db
		.select({ entryId: directoryTag.entryId, value: directoryTag.value })
		.from(directoryTag)
		.where(
			and(
				eq(directoryTag.kind, 'instrument'),
				inArray(
					directoryTag.entryId,
					rows.map((r) => r.entryId)
				)
			)
		)
		.orderBy(asc(directoryTag.value));

	const byEntry = new Map<string, string[]>();
	for (const t of tags) {
		const list = byEntry.get(t.entryId) ?? [];
		list.push(t.value);
		byEntry.set(t.entryId, list);
	}

	return rows.map((r) => {
		// Gate 3. `teachingContact` when set, otherwise the member's own — and the
		// fallback runs through the same gate, so a members-only directory contact
		// stays withheld rather than being published by this module.
		const resolved = (r.teachingContact ?? r.entryContact) as DirectoryContact | null;
		const contact = contactForView(visibility, resolved);
		return {
			userId: r.userId,
			name: r.name,
			pronouns: r.pronouns,
			image: r.image,
			headline: r.headline,
			blurb: r.blurb,
			ratesNote: r.ratesNote,
			bookingUrl: r.bookingUrl,
			instruments: byEntry.get(r.entryId) ?? [],
			contact,
			contactWithheld: resolved != null && contact == null
		};
	});
}

/**
 * Whether this member's teaching listing would show a contact publicly.
 *
 * Drives the nudge on their own profile and nothing else — an instructor listing
 * nobody can contact is the feature failing at its one job, and the member is
 * the only person who can fix it. It reports on their own record only, so it
 * discloses nothing they cannot already see.
 */
export async function publicContactStatus(
	userId: string
): Promise<{ hasPublicContact: boolean; hasAnyContact: boolean }> {
	const [row] = await db
		.select({
			teachingContact: instructor.teachingContact,
			entryContact: directoryEntry.contact
		})
		.from(instructor)
		.leftJoin(directoryEntry, eq(directoryEntry.userId, instructor.userId))
		.where(eq(instructor.userId, userId))
		.limit(1);

	if (!row) return { hasPublicContact: false, hasAnyContact: false };

	const resolved = (row.teachingContact ?? row.entryContact) as DirectoryContact | null;
	return {
		hasPublicContact: contactForView('public', resolved) != null,
		hasAnyContact: resolved != null
	};
}
